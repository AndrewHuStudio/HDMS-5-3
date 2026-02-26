"""
文件上传工具函数
提供流式保存上传文件、大小限制校验等通用方法。
"""
from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, UploadFile

from core import config

_CHUNK_SIZE = 1024 * 1024  # 每次读取 1 MB


def _max_upload_bytes() -> int:
    """返回允许上传的最大字节数"""
    return config.MAX_UPLOAD_MB * 1024 * 1024


def upload_size_error() -> HTTPException:
    """构造文件过大的 413 异常"""
    return HTTPException(
        status_code=413,
        detail=f"不可以放置超过{config.MAX_UPLOAD_MB}mb的模型",
    )


def ensure_file_size_within_limit(path: Path) -> None:
    """检查已保存文件是否超出大小限制，超出则抛出 413"""
    max_bytes = _max_upload_bytes()
    if path.stat().st_size > max_bytes:
        raise upload_size_error()


async def save_upload_file(upload_file: UploadFile, target_path: Path) -> int:
    """
    流式保存上传文件到目标路径，同时实时校验大小限制。
    超出限制时删除已写入的临时文件并抛出 413。
    返回实际写入的字节数。
    """
    max_bytes = _max_upload_bytes()
    size = 0
    target_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with target_path.open("wb") as target:
            while True:
                chunk = await upload_file.read(_CHUNK_SIZE)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise upload_size_error()
                target.write(chunk)
    except HTTPException:
        if target_path.exists():
            target_path.unlink()
        raise
    finally:
        await upload_file.close()

    return size
