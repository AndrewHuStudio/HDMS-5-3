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


MAX_PARALLEL_REQUESTS = _read_parallel_limit()


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

    response = await client.post(completion_url, json=payload, headers=headers)
    response.raise_for_status()
    data = response.json()
    text = _extract_completion_text(data)
    return text or "暂无建议"


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
            logger.error(f"生成 {feature.name} 建议失败: {exc}")
            return SuggestionOutput(id=feature.id, suggestion=""), True


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
    async with httpx.AsyncClient(timeout=40.0) as client:
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

    if failed_feature_ids and len(failed_feature_ids) == len(request.features):
        raise HTTPException(status_code=502, detail="AI 建议服务不可用，请稍后重试")

    return AISuggestionResponse(suggestions=suggestions)
