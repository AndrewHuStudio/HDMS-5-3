"""
管控审批清单服务 FastAPI 应用入口
提供 AI 建议生成接口
"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import load_env_file

load_env_file()

from routes import ai_suggestion, pdf_export

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="HDMS Approval Checklist API")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(ai_suggestion.router)
app.include_router(pdf_export.router)

# 兼容反向代理前缀：允许通过 /approval/* 访问
app.include_router(ai_suggestion.router, prefix="/approval")
app.include_router(pdf_export.router, prefix="/approval")


@app.get("/health")
def health() -> dict:
    """健康检查端点"""
    return {"status": "ok", "service": "approval_checklist"}


@app.get("/approval/health")
def health_with_prefix() -> dict:
    """兼容带 /approval 前缀的健康检查端点"""
    return {"status": "ok", "service": "approval_checklist"}
