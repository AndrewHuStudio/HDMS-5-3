from __future__ import annotations

import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from core.upload_utils import save_upload_file
from core import config
from services.rhino_model import extract_layer_info

router = APIRouter(prefix="/models", tags=["models"])

# 线程池用于运行阻塞的图层提取
_executor = ThreadPoolExecutor(max_workers=2)


@router.post("/import")
async def import_model(
    file: UploadFile = File(...),
    skip_layers: bool = Query(False, description="跳过图层提取以加快上传速度"),
):
    if not file.filename.lower().endswith(".3dm"):
        raise HTTPException(status_code=400, detail="Only .3dm files are supported")

    model_id = uuid.uuid4().hex
    target_path = config.MODEL_STORAGE_PATH / f"{model_id}.3dm"

    size_bytes = await save_upload_file(file, target_path)

    result = {
        "status": "ok",
        "model_id": model_id,
        "filename": Path(file.filename).name,
        "model_path": target_path.name,
        "size_mb": round(size_bytes / (1024 * 1024), 2),
        "layers": [],
        "warnings": [],
    }

    # 如果不跳过图层提取，则在线程池中异步运行
    if not skip_layers:
        loop = asyncio.get_event_loop()
        try:
            layers, warnings = await loop.run_in_executor(
                _executor, extract_layer_info, target_path
            )
            result["layers"] = layers
            result["warnings"] = warnings
        except ValueError as exc:
            if target_path.exists():
                target_path.unlink()
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return result


@router.get("/{model_path}/layers")
async def get_model_layers(model_path: str):
    """单独获取模型图层信息"""
    target_path = config.MODEL_STORAGE_PATH / model_path
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Model not found")

    loop = asyncio.get_event_loop()
    try:
        layers, warnings = await loop.run_in_executor(
            _executor, extract_layer_info, target_path
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"layers": layers, "warnings": warnings}
