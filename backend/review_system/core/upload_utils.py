from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, UploadFile

from core import config

_CHUNK_SIZE = 1024 * 1024


def _max_upload_bytes() -> int:
    return config.MAX_UPLOAD_MB * 1024 * 1024


def upload_size_error() -> HTTPException:
    return HTTPException(
        status_code=413,
        detail=f"不可以放置超过{config.MAX_UPLOAD_MB}mb的模型",
    )


def ensure_file_size_within_limit(path: Path) -> None:
    max_bytes = _max_upload_bytes()
    if path.stat().st_size > max_bytes:
        raise upload_size_error()


async def save_upload_file(upload_file: UploadFile, target_path: Path) -> int:
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
