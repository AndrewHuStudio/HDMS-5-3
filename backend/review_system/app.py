"""
管控审查系统 FastAPI 应用入口
注册所有检测功能路由，配置 CORS 中间件。
"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core import config
from routes import (
    fire_ladder,
    green_setback_check,
    height_check,
    models,
    plaza_setback_check,
    pedestrian_entrance_check,
    setback_check,
    setback_rate_check,
    sight_corridor,
    sky_bridge,
    vehicle_entrance_check,
)

logger = logging.getLogger(__name__)

try:
    from backend.approval_checklist.routes import router as approval_checklist_router
except Exception as exc:  # noqa: BLE001
    approval_checklist_router = None
    logger.warning("approval_checklist router is unavailable: %s", exc)

app = FastAPI(title="HDMS Review System API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=config.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册各检测功能路由
app.include_router(models.router)
app.include_router(height_check.router)
app.include_router(setback_check.router)
app.include_router(sight_corridor.router)
app.include_router(fire_ladder.router)
app.include_router(sky_bridge.router)
app.include_router(green_setback_check.router)
app.include_router(plaza_setback_check.router)
app.include_router(setback_rate_check.router)
app.include_router(vehicle_entrance_check.router)
app.include_router(pedestrian_entrance_check.router)
if approval_checklist_router is not None:
    app.include_router(approval_checklist_router)


@app.get("/health")
def health() -> dict:
    """健康检查端点"""
    return {"status": "ok"}
