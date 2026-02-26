"""
空中连廊检测路由
POST /sky-bridge-check/prepare - 提取地块连接关系，供前端渲染连廊示意图
POST /sky-bridge-check - 检测空中连廊是否满足净高、宽度、高度要求
POST /sky-bridge/check  - 同上（别名）
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from core import config
from services.sky_bridge import (
    check_sky_bridge_pure_python,
    prepare_sky_bridge_info,
)

router = APIRouter()
logger = logging.getLogger(__name__)


class SkyBridgePrepareRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    plot_layer: str = "场景_地块"
    corridor_layer: str = "模型_空中连廊"
    plot_name_key: str = "地块名称"
    connection_key: str = "空中连接地块"


class SkyBridgeCheckRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_path: str
    plot_layer: str = "场景_地块"
    corridor_layer: str = "模型_空中连廊"
    plot_name_key: str = "地块名称"
    connection_key: str = "空中连接地块"
    elevation: float = 7.0
    min_width: float = 6.0
    min_height: float = 4.0
    connections: Optional[List[List[str]]] = None


def _resolve_model_path(model_path: str) -> Path:
    """将相对路径解析为绝对路径，文件不存在时抛出 404"""
    path = Path(model_path)
    if not path.is_absolute():
        path = (config.MODEL_STORAGE_PATH / path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"模型文件不存在: {path}")
    return path


@router.post("/sky-bridge-check/prepare")
def sky_bridge_prepare(request: SkyBridgePrepareRequest) -> Dict[str, Any]:
    """提取地块连接关系，供前端渲染连廊示意图"""
    resolved_path = _resolve_model_path(request.model_path)
    try:
        return prepare_sky_bridge_info(
            model_path=resolved_path,
            plot_layer=request.plot_layer,
            corridor_layer=request.corridor_layer,
            plot_name_key=request.plot_name_key,
            connection_key=request.connection_key,
        )
    except ValueError as exc:
        logger.warning("空中连廊准备失败: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sky-bridge-check")
@router.post("/sky-bridge/check")
def sky_bridge_check(request: SkyBridgeCheckRequest) -> Dict[str, Any]:
    """空中连廊检测接口"""
    resolved_path = _resolve_model_path(request.model_path)
    try:
        return check_sky_bridge_pure_python(
            model_path=resolved_path,
            plot_layer=request.plot_layer,
            corridor_layer=request.corridor_layer,
            plot_name_key=request.plot_name_key,
            connection_key=request.connection_key,
            elevation=request.elevation,
            min_width=request.min_width,
            min_height=request.min_height,
            connections=request.connections,
        )
    except ValueError as exc:
        logger.warning("空中连廊检测失败: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
