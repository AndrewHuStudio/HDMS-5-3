"""
车行出入口检测路由
POST /vehicle-entrance-check - 检测车行出入口与道路交叉口的最小距离是否合规
POST /vehicle-entrance/check  - 同上（别名）
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from core import config
from services.vehicle_entrance_check import check_vehicle_entrance_distance

router = APIRouter()
logger = logging.getLogger(__name__)


class VehicleEntranceCheckRequest(BaseModel):
    """车行出入口检测请求参数"""
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    entrance_layer: str = "场地_车行出入口"
    main_intersection_layer: str = "场地_主干路交叉口"
    secondary_intersection_layer: str = "场地_次干路交叉口"
    branch_intersection_layer: str = "场地_支路交叉口"
    plot_layer: str = "场景_地块"
    min_main_distance: float = 100.0
    min_secondary_distance: float = 80.0
    min_branch_distance: float = 50.0


def _resolve_model_path(model_path: str) -> Path:
    """将相对路径解析为绝对路径，文件不存在时抛出 404"""
    path = Path(model_path)
    if not path.is_absolute():
        path = (config.MODEL_STORAGE_PATH / path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {path}")
    return path


@router.post("/vehicle-entrance-check")
@router.post("/vehicle-entrance/check")
def vehicle_entrance_check(request: VehicleEntranceCheckRequest) -> Dict[str, Any]:
    """车行出入口检测接口，验证出入口与各级道路交叉口的最小间距"""
    resolved_path = _resolve_model_path(request.model_path)
    try:
        return check_vehicle_entrance_distance(
            model_path=resolved_path,
            entrance_layer=request.entrance_layer,
            main_intersection_layer=request.main_intersection_layer,
            secondary_intersection_layer=request.secondary_intersection_layer,
            branch_intersection_layer=request.branch_intersection_layer,
            plot_layer=request.plot_layer,
            min_main_distance=request.min_main_distance,
            min_secondary_distance=request.min_secondary_distance,
            min_branch_distance=request.min_branch_distance,
        )
    except ValueError as exc:
        logger.warning(
            "Vehicle entrance check failed: %s (entrance_layer=%s)",
            exc,
            request.entrance_layer,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
