"""
人行出入口检测路由
POST /pedestrian-entrance-check - 检测人行出入口数量是否满足最低要求
POST /pedestrian-entrance/check  - 同上（别名）
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from core import config
from services.pedestrian_entrance_check import check_pedestrian_entrance_count

router = APIRouter()
logger = logging.getLogger(__name__)


class PedestrianEntranceCheckRequest(BaseModel):
    """人行出入口检测请求参数"""
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    entrance_layer: str = "场地_人行出入口"
    redline_layer: str = "限制_建筑红线"
    redline_layers: list[str] | None = None
    on_curve_tolerance: float = 1.0
    min_required_count: int = 2


def _resolve_model_path(model_path: str) -> Path:
    """将相对路径解析为绝对路径，文件不存在时抛出 404"""
    path = Path(model_path)
    if not path.is_absolute():
        path = (config.MODEL_STORAGE_PATH / path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {path}")
    return path


@router.post("/pedestrian-entrance-check")
@router.post("/pedestrian-entrance/check")
def pedestrian_entrance_check(request: PedestrianEntranceCheckRequest) -> Dict[str, Any]:
    """人行出入口检测接口，验证出入口数量是否满足最低要求"""
    resolved_path = _resolve_model_path(request.model_path)
    try:
        return check_pedestrian_entrance_count(
            model_path=resolved_path,
            entrance_layer=request.entrance_layer,
            redline_layer=request.redline_layer,
            redline_layers=request.redline_layers,
            on_curve_tolerance=request.on_curve_tolerance,
            min_required_count=request.min_required_count,
        )
    except ValueError as exc:
        logger.warning(
            "Pedestrian entrance check failed: %s (entrance_layer=%s)",
            exc,
            request.entrance_layer,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
