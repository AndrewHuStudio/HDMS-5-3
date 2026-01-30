"""
视线通廊检测API路由
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from rhino_api.core import config
from rhino_api.services.sight_corridor_check import check_sight_corridor

router = APIRouter()
logger = logging.getLogger(__name__)


class SightCorridorPosition(BaseModel):
    x: float
    y: float
    z: float


class SightCorridorRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    building_layer: str = "模型_建筑体块"
    observer_position: SightCorridorPosition
    hemisphere_radius: float = 100.0


def _resolve_model_path(model_path: str) -> Path:
    path = Path(model_path)
    if not path.is_absolute():
        path = (config.MODEL_STORAGE_PATH / path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {path}")
    return path


@router.post("/sight-corridor/check")
def sight_corridor_check(request: SightCorridorRequest):
    """视线通廊检测接口 - 计算观察点的可见建筑"""
    resolved_path = _resolve_model_path(request.model_path)
    try:
        return check_sight_corridor(
            model_path=resolved_path,
            building_layer=request.building_layer,
            observer_position=(
                request.observer_position.x,
                request.observer_position.y,
                request.observer_position.z,
            ),
            hemisphere_radius=request.hemisphere_radius,
        )
    except ValueError as exc:
        logger.warning(
            "Sight corridor check failed: %s (building_layer=%s, position=(%s, %s, %s), radius=%s)",
            exc,
            request.building_layer,
            request.observer_position.x,
            request.observer_position.y,
            request.observer_position.z,
            request.hemisphere_radius,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
