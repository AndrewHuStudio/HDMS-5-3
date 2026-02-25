from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from core import config
from services.green_setback_check import check_green_setback_violation

router = APIRouter()
logger = logging.getLogger(__name__)


class GreenSetbackCheckRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    green_setback_layer: str = "场地_绿地退线"
    building_layer: str = "模型_建筑体块"
    ignore_height: float = 2.0


def _resolve_model_path(model_path: str) -> Path:
    path = Path(model_path)
    if not path.is_absolute():
        path = (config.MODEL_STORAGE_PATH / path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {path}")
    return path


@router.post("/green-setback-check")
@router.post("/green-setback/check")
def green_setback_check(request: GreenSetbackCheckRequest) -> Dict[str, Any]:
    resolved_path = _resolve_model_path(request.model_path)
    try:
        return check_green_setback_violation(
            model_path=resolved_path,
            green_setback_layer=request.green_setback_layer,
            building_layer=request.building_layer,
            ignore_height=request.ignore_height,
        )
    except ValueError as exc:
        logger.warning(
            "Green setback check failed: %s (green_setback_layer=%s, building_layer=%s)",
            exc,
            request.green_setback_layer,
            request.building_layer,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
