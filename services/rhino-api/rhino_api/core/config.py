from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
APP_ENV = os.getenv("APP_ENV", "development").lower()
MODEL_STORAGE_PATH = Path(
    os.getenv("MODEL_STORAGE_PATH", str(BASE_DIR / ".." / ".." / "data" / "uploads"))
).resolve()
CACHE_STORAGE_PATH = Path(
    os.getenv("CACHE_STORAGE_PATH", str(BASE_DIR / ".." / ".." / "data" / "cache"))
).resolve()
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "500"))

DEFAULT_CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,http://172.20.16.1:3000"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]
CORS_ALLOW_PRIVATE_ORIGINS = os.getenv(
    "CORS_ALLOW_PRIVATE_ORIGINS", "1" if APP_ENV == "development" else "0"
).lower() in {"1", "true", "yes"}
CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX", "").strip()

if CORS_ALLOW_PRIVATE_ORIGINS and not CORS_ORIGIN_REGEX:
    CORS_ORIGIN_REGEX = (
        r"^http://("
        r"localhost|127\.0\.0\.1|"
        r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
        r"192\.168\.\d{1,3}\.\d{1,3}|"
        r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
        r")(:\d+)?$"
    )
