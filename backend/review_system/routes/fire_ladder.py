from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from core import config
from services.fire_ladder import check_fire_ladder_pure_python

router = APIRouter()
logger = logging.getLogger(__name__)


class FireLadderCheckRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    building_layer: str = "模型_建筑体块"
    fire_ladder_layer: str = "模型_消防登高面"
    redline_layer: str = "限制_建筑红线"
    plot_layer: str = "场景_地块"
    min_width: float = 10.0
    min_distance: float = 5.0
    max_distance: float = 10.0
    length_ratio: float = 0.25


def _resolve_model_path(model_path: str) -> Path:
    path = Path(model_path)
    if not path.is_absolute():
        path = (config.MODEL_STORAGE_PATH / path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {path}")
    return path


@router.post("/fire-ladder-check")
@router.post("/fire-ladder/check")
def fire_ladder_check(request: FireLadderCheckRequest) -> Dict[str, Any]:
    resolved_path = _resolve_model_path(request.model_path)
    try:
        return check_fire_ladder_pure_python(
            model_path=resolved_path,
            building_layer=request.building_layer,
            fire_ladder_layer=request.fire_ladder_layer,
            redline_layer=request.redline_layer,
            plot_layer=request.plot_layer,
            min_width=request.min_width,
            min_distance=request.min_distance,
            max_distance=request.max_distance,
            length_ratio=request.length_ratio,
        )
    except ValueError as exc:
        logger.warning(
            "Fire ladder check failed: %s (building_layer=%s, fire_ladder_layer=%s, redline_layer=%s)",
            exc,
            request.building_layer,
            request.fire_ladder_layer,
            request.redline_layer,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
