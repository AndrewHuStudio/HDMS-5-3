"""
贴线率检测 API
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from rhino_api.core import config
from rhino_api.services.setback_check import check_setback_rate_pure_python

router = APIRouter()
logger = logging.getLogger(__name__)


class SetbackCheckRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    building_layer: str = "模型_建筑体块"
    setback_layer: str = "限制_建筑退线"
    plot_layer: str = "场景_地块"
    sample_step: float = 1.0
    tolerance: float = 0.5
    required_rate: Optional[float] = None


def _resolve_model_path(model_path: str) -> Path:
    path = Path(model_path)
    if not path.is_absolute():
        path = (config.MODEL_STORAGE_PATH / path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {path}")
    return path


@router.post("/setback-check")
def setback_check(request: SetbackCheckRequest) -> Dict[str, Any]:
    """贴线率检测接口 - 纯Python实现"""
    resolved_path = _resolve_model_path(request.model_path)
    try:
        return check_setback_rate_pure_python(
            model_path=resolved_path,
            building_layer=request.building_layer,
            setback_layer=request.setback_layer,
            plot_layer=request.plot_layer,
            sample_step=request.sample_step,
            tolerance=request.tolerance,
            required_rate=request.required_rate,
        )
    except ValueError as exc:
        logger.warning(
            "Setback check failed: %s (building_layer=%s, setback_layer=%s)",
            exc,
            request.building_layer,
            request.setback_layer,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
