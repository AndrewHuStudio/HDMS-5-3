"""AI 建议生成路由。"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()

HDMS_BASE_URL = os.getenv("HDMS_BASE_URL", "https://api.apiyi.com/v1")
HDMS_API_KEY = os.getenv("HDMS_API_KEY", "")
CHECK_LIST_MODEL = os.getenv("HDMS_CHECK_LIST_MODEL", os.getenv("HDMS_QA_MODEL", "deepseek-r1"))


def _read_parallel_limit() -> int:
    raw_value = os.getenv("HDMS_CHECK_LIST_PARALLEL", "8")
    try:
        return min(12, max(1, int(raw_value)))
    except ValueError:
        return 8


def _read_float_env(name: str, default: float, minimum: float) -> float:
    raw_value = os.getenv(name, str(default))
    try:
        return max(minimum, float(raw_value))
    except ValueError:
        return default


def _read_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw_value = os.getenv(name, str(default))
    try:
        return min(maximum, max(minimum, int(raw_value)))
    except ValueError:
        return default


MAX_PARALLEL_REQUESTS = _read_parallel_limit()
REQUEST_TIMEOUT_SECONDS = _read_float_env("HDMS_CHECK_LIST_TIMEOUT_SECONDS", 45.0, 5.0)
MAX_RETRY_ATTEMPTS = _read_int_env("HDMS_CHECK_LIST_RETRIES", 2, 0, 5)
RETRY_BASE_DELAY_SECONDS = _read_float_env("HDMS_CHECK_LIST_RETRY_BASE_DELAY", 0.8, 0.1)


def _normalize_base_url(value: str) -> str:
    base = value.rstrip("/")
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    return base


def _extract_completion_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""

    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        return ""

    message = first_choice.get("message")
    if not isinstance(message, dict):
        return ""

    content = message.get("content")
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts: list[str] = []
        for chunk in content:
            if isinstance(chunk, dict) and chunk.get("type") == "text":
                text_value = chunk.get("text")
                if isinstance(text_value, str) and text_value.strip():
                    parts.append(text_value.strip())
        return "\n".join(parts).strip()

    return ""


async def _request_suggestion(client: httpx.AsyncClient, prompt: str) -> str:
    if not HDMS_API_KEY:
        raise HTTPException(status_code=500, detail="HDMS_API_KEY 未配置，无法生成审查建议")

    completion_url = f"{_normalize_base_url(HDMS_BASE_URL)}/chat/completions"
    payload = {
        "model": CHECK_LIST_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "你是城市管控审查助手。请给出专业、可执行、简洁的整改建议。",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        "temperature": 0.2,
        "max_tokens": 160,
    }
    headers = {
        "Authorization": f"Bearer {HDMS_API_KEY}",
        "Content-Type": "application/json",
    }

    retriable_status_codes = {408, 409, 425, 429, 500, 502, 503, 504}
    last_error: Exception | None = None

    for attempt in range(MAX_RETRY_ATTEMPTS + 1):
        try:
            response = await client.post(
                completion_url,
                json=payload,
                headers=headers,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            if response.status_code in retriable_status_codes:
                raise httpx.HTTPStatusError(
                    f"upstream status={response.status_code}",
                    request=response.request,
                    response=response,
                )
            response.raise_for_status()
            data = response.json()
            text = _extract_completion_text(data)
            return text or "暂无建议"
        except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as exc:
            last_error = exc
            is_retriable = True
            if isinstance(exc, httpx.HTTPStatusError):
                status_code = exc.response.status_code if exc.response else None
                is_retriable = bool(status_code in retriable_status_codes)
            if (not is_retriable) or attempt >= MAX_RETRY_ATTEMPTS:
                raise
            await asyncio.sleep(RETRY_BASE_DELAY_SECONDS * (2 ** attempt))

    if last_error:
        raise last_error
    raise RuntimeError("request suggestion failed unexpectedly")


def _build_fallback_suggestion(feature: "FeatureInput") -> str:
    summary = (feature.summary or "").strip()
    issue_hint = summary if summary else "当前检测输出信息不完整"
    points = [
        "先补齐问题对应的规范条款与验收口径，明确整改目标。",
        f"围绕“{issue_hint}”拆解整改步骤，按优先级逐项闭环。",
        "补充责任人、完成时限和复核标准，避免重复问题。",
    ]
    return "重点：\n" + "\n".join(f"- {item}" for item in points) + (
        f"\n\n总结：建议优先处理“{feature.name}”相关风险点，按“问题定位-整改执行-复核留痕”三步推进。"
    )


async def _generate_feature_suggestion(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    feature: "FeatureInput",
) -> tuple[SuggestionOutput, bool]:
    prompt = f"""请针对以下管控审查结果提供专业建议，并严格按指定格式输出：

检测项目：{feature.name}
检测结果：{feature.summary}

输出要求：
1) 先写“重点：”并列出 2-4 条要点，每条一行，格式为“- ...”；
2) 再写“总结：”并用一段话概括总体建议；
3) 全文简洁、可执行，不要输出其他无关说明。"""

    async with semaphore:
        try:
            suggestion_text = await _request_suggestion(client, prompt)
            return SuggestionOutput(id=feature.id, suggestion=suggestion_text), False
        except Exception as exc:
            logger.error(
                "生成 %s 建议失败 (%s): %r",
                feature.name,
                type(exc).__name__,
                exc,
            )
            return SuggestionOutput(
                id=feature.id,
                suggestion=_build_fallback_suggestion(feature),
            ), True


class FeatureInput(BaseModel):
    id: str
    name: str
    summary: str
    raw_result: Any


class AISuggestionRequest(BaseModel):
    features: list[FeatureInput]


class SuggestionOutput(BaseModel):
    id: str
    suggestion: str


class AISuggestionResponse(BaseModel):
    suggestions: list[SuggestionOutput]


@router.post("/ai-suggestion", response_model=AISuggestionResponse)
async def generate_ai_suggestions(request: AISuggestionRequest):
    """批量生成 AI 审查建议。"""
    if not request.features:
        return AISuggestionResponse(suggestions=[])

    failed_feature_ids: list[str] = []
    semaphore = asyncio.Semaphore(MAX_PARALLEL_REQUESTS)
    timeout = httpx.Timeout(
        connect=min(10.0, REQUEST_TIMEOUT_SECONDS),
        read=REQUEST_TIMEOUT_SECONDS,
        write=min(20.0, REQUEST_TIMEOUT_SECONDS),
        pool=10.0,
    )
    async with httpx.AsyncClient(timeout=timeout) as client:
        tasks = [
            _generate_feature_suggestion(client, semaphore, feature)
            for feature in request.features
        ]
        task_results = await asyncio.gather(*tasks)

    suggestions: list[SuggestionOutput] = []
    for feature, (suggestion, failed) in zip(request.features, task_results):
        suggestions.append(suggestion)
        if failed:
            failed_feature_ids.append(feature.id)

    if failed_feature_ids:
        logger.warning(
            "AI suggestion degraded for %d/%d features. ids=%s",
            len(failed_feature_ids),
            len(request.features),
            ",".join(failed_feature_ids),
        )

    return AISuggestionResponse(suggestions=suggestions)
