from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from core import config
from services.plaza_setback_check import check_plaza_setback_violation

router = APIRouter()
logger = logging.getLogger(__name__)


class PlazaSetbackCheckRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    plaza_setback_layer: str = "\u573a\u5730_\u5e7f\u573a\u9000\u7ebf"
    building_layer: str = "\u6a21\u578b_\u5efa\u7b51\u4f53\u5757"
    ignore_height: float = 2.0


def _resolve_model_path(model_path: str) -> Path:
    path = Path(model_path)
    if not path.is_absolute():
        path = (config.MODEL_STORAGE_PATH / path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {path}")
    return path


@router.post("/plaza-setback-check")
@router.post("/plaza-setback/check")
def plaza_setback_check(request: PlazaSetbackCheckRequest) -> Dict[str, Any]:
    resolved_path = _resolve_model_path(request.model_path)
    try:
        return check_plaza_setback_violation(
            model_path=resolved_path,
            plaza_setback_layer=request.plaza_setback_layer,
            building_layer=request.building_layer,
            ignore_height=request.ignore_height,
        )
    except ValueError as exc:
        logger.warning(
            "Plaza setback check failed: %s (plaza_setback_layer=%s, building_layer=%s)",
            exc,
            request.plaza_setback_layer,
            request.building_layer,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
