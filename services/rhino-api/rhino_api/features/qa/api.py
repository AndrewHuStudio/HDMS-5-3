from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter()
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "你是HDMS（高强度片区数字化管控平台）的问答助手。"
    "回答要简洁、结构清晰，优先使用中文。"
    "如果缺少必要资料，请说明需要的资料。"
)


class ChatMessage(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    role: str
    content: str


class ChatRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    question: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    answer: str
    model: str


def _normalize_base_url(base_url: str) -> str:
    cleaned = base_url.rstrip("/")
    if cleaned.endswith("/v1"):
        return cleaned
    return f"{cleaned}/v1"


def _find_env_file() -> Path | None:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".env"
        if candidate.exists():
            return candidate
    return None


def _read_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        content = env_path.read_text(encoding="utf-8")
    except OSError:
        return values

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'").strip()
        if key and key not in values:
            values[key] = value
    return values


def _load_config() -> tuple[str, str, str]:
    base_url = (
        os.getenv("HDMS_BASE_URL")
        or os.getenv("HDMS_API_BASE_URL")
        or os.getenv("HDMS_API_BASE")
        or ""
    ).strip()
    api_key = os.getenv("HDMS_API_KEY", "").strip()
    model = (
        os.getenv("HDMS_TEXT_MODEL")
        or os.getenv("HDMS_MODEL")
        or ""
    ).strip()

    if not base_url or not api_key or not model:
        env_path = _find_env_file()
        if env_path:
            env_values = _read_env_file(env_path)
            if not base_url:
                base_url = (
                    env_values.get("HDMS_BASE_URL")
                    or env_values.get("HDMS_API_BASE_URL")
                    or env_values.get("HDMS_API_BASE")
                    or ""
                )
            if not api_key:
                api_key = env_values.get("HDMS_API_KEY", "")
            if not model:
                model = (
                    env_values.get("HDMS_TEXT_MODEL")
                    or env_values.get("HDMS_MODEL")
                    or ""
                )

    if not base_url:
        base_url = "https://api.apiyi.com"
    if not model:
        model = "deepseek-v3"
    return _normalize_base_url(base_url), api_key.strip(), model.strip()


def _build_messages(history: list[ChatMessage], question: str) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for item in history:
        role = item.role
        content = item.content.strip()
        if role not in {"user", "assistant"} or not content:
            continue
        messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})
    return messages


def _request_chat(
    base_url: str, api_key: str, model: str, messages: list[dict[str, str]]
) -> str:
    endpoint = f"{base_url}/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
    }
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8")
        except Exception:
            detail = str(exc)
        logger.warning("QA request failed: %s", detail)
        raise HTTPException(status_code=exc.code, detail=detail) from exc
    except urllib.error.URLError as exc:
        logger.error("QA request error: %s", exc)
        raise HTTPException(status_code=502, detail="Upstream QA request failed") from exc

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        logger.error("QA response decode failed: %s", body)
        raise HTTPException(status_code=502, detail="Invalid response from upstream") from exc

    choices = payload.get("choices") or []
    if not choices:
        raise HTTPException(status_code=502, detail="Upstream returned empty choices")

    message = choices[0].get("message") or {}
    content = (message.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=502, detail="Upstream returned empty content")
    return content


@router.post("/qa/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    base_url, api_key, model = _load_config()
    if not api_key:
        raise HTTPException(status_code=400, detail="HDMS_API_KEY is not set")

    trimmed_history = request.history[-8:]
    messages = _build_messages(trimmed_history, request.question.strip())
    answer = _request_chat(base_url, api_key, model, messages)
    return ChatResponse(answer=answer, model=model)
