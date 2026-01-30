from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from rhino_api.core import config
from rhino_api.services.height_limit_pure import check_height_limit_pure_python

router = APIRouter()
logger = logging.getLogger(__name__)


class HeightCheckPurePythonRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    building_layer: str = "模型_建筑体块"
    setback_layer: str = "限制_建筑退线"
    default_height_limit: float = 100.0


def _resolve_model_path(model_path: str) -> Path:
    path = Path(model_path)
    if not path.is_absolute():
        path = (config.MODEL_STORAGE_PATH / path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {path}")
    return path


@router.post("/height-check/pure-python")
def height_check_pure_python(request: HeightCheckPurePythonRequest) -> Dict[str, Any]:
    """限高检测接口 - 纯Python实现，基于固定图层名称和UserText"""
    resolved_path = _resolve_model_path(request.model_path)
    try:
        result = check_height_limit_pure_python(
            model_path=resolved_path,
            building_layer=request.building_layer,
            setback_layer=request.setback_layer,
            default_height_limit=request.default_height_limit,
        )
        logger.info(f"Height check result keys: {list(result.keys())}")
        logger.info(f"Has setback_volumes: {'setback_volumes' in result}")
        if 'setback_volumes' in result:
            logger.info(f"setback_volumes count: {len(result['setback_volumes'])}")
        return result
    except ValueError as exc:
        logger.warning(
            "Height check (pure Python) failed: %s (building_layer=%s, setback_layer=%s, default_height_limit=%s)",
            exc,
            request.building_layer,
            request.setback_layer,
            request.default_height_limit,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
