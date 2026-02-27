"""
AI 建议生成路由
调用 QA Assistant 服务生成审查建议
"""
from __future__ import annotations

import os
import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()

QA_ASSISTANT_BASE = os.getenv("HDMS_QA_BASE_URL", "http://localhost:8002")


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
    """
    批量生成 AI 审查建议
    """
    suggestions = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        for feature in request.features:
            try:
                # 构建 prompt
                prompt = f"""请针对以下管控审查结果提供专业建议：

检测项目：{feature.name}
检测结果：{feature.summary}

请提供简洁的改进建议（50字以内）。"""

                # 调用 QA Assistant
                response = await client.post(
                    f"{QA_ASSISTANT_BASE}/qa/chat",
                    json={"question": prompt},
                    headers={"Content-Type": "application/json"},
                )

                if response.status_code == 200:
                    data = response.json()
                    suggestion_text = data.get("answer", "暂无建议")
                else:
                    suggestion_text = "AI 建议生成失败"

                suggestions.append(
                    SuggestionOutput(id=feature.id, suggestion=suggestion_text)
                )

            except Exception as e:
                logger.error(f"生成 {feature.name} 建议失败: {e}")
                suggestions.append(
                    SuggestionOutput(id=feature.id, suggestion="建议生成失败")
                )

    return AISuggestionResponse(suggestions=suggestions)
