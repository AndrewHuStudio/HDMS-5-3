from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
MODEL_STORAGE_PATH = Path(
    os.getenv("MODEL_STORAGE_PATH", str(BASE_DIR / ".." / ".." / "data" / "uploads"))
).resolve()
CACHE_STORAGE_PATH = Path(
    os.getenv("CACHE_STORAGE_PATH", str(BASE_DIR / ".." / ".." / "data" / "cache"))
).resolve()
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "500"))

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]
