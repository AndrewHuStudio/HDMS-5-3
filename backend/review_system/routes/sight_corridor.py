"""
视线通廊检测API路由
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from core import config
from services.sight_corridor_check import check_corridor_collision

router = APIRouter()
logger = logging.getLogger(__name__)


class SightCorridorCollisionRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    corridor_layer: str = "限制_视线通廊"
    building_layer: str = "模型_建筑体块"


def _resolve_model_path(model_path: str) -> Path:
    path = Path(model_path)
    if not path.is_absolute():
        path = (config.MODEL_STORAGE_PATH / path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {path}")
    return path


@router.post("/sight-corridor/collision")
def sight_corridor_collision(request: SightCorridorCollisionRequest):
    """视线通廊碰撞检测接口 - 判断通廊与建筑是否真实相交"""
    resolved_path = _resolve_model_path(request.model_path)
    try:
        return check_corridor_collision(
            model_path=resolved_path,
            corridor_layer=request.corridor_layer,
            building_layer=request.building_layer,
        )
    except ValueError as exc:
        logger.warning(
            "Sight corridor collision failed: %s (corridor_layer=%s, building_layer=%s)",
            exc,
            request.corridor_layer,
            request.building_layer,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
