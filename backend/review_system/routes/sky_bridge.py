from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from core import config
from services.sky_bridge import check_sky_bridge_pure_python

router = APIRouter()
logger = logging.getLogger(__name__)


class SkyBridgeCheckRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    corridor_layer: str = "模型_空中连廊"
    plot_layer: str = "场景_地块"
    min_width: float = 4.0
    min_height: float = 2.2
    min_clearance: float = 5.0


def _resolve_model_path(model_path: str) -> Path:
    path = Path(model_path)
    if not path.is_absolute():
        path = (config.MODEL_STORAGE_PATH / path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {path}")
    return path


@router.post("/sky-bridge-check")
@router.post("/sky-bridge/check")
def sky_bridge_check(request: SkyBridgeCheckRequest) -> Dict[str, Any]:
    resolved_path = _resolve_model_path(request.model_path)
    try:
        return check_sky_bridge_pure_python(
            model_path=resolved_path,
            corridor_layer=request.corridor_layer,
            plot_layer=request.plot_layer,
            min_width=request.min_width,
            min_height=request.min_height,
            min_clearance=request.min_clearance,
        )
    except ValueError as exc:
        logger.warning(
            "Sky bridge check failed: %s (corridor_layer=%s, plot_layer=%s)",
            exc,
            request.corridor_layer,
            request.plot_layer,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
