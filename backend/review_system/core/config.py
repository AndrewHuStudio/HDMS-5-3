"""
管控审查系统配置
从环境变量读取路径、上传限制和 CORS 设置，开发环境自动允许局域网来源。
"""
from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
BASE_DIR = PROJECT_ROOT
APP_ENV = os.getenv("APP_ENV", "development").lower()


def _resolve_project_path(env_key: str, default_rel: str) -> Path:
    raw = os.getenv(env_key, "").strip()
    path = Path(raw) if raw else (PROJECT_ROOT / default_rel)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


MODEL_STORAGE_PATH = _resolve_project_path("MODEL_STORAGE_PATH", "data/uploads")
CACHE_STORAGE_PATH = _resolve_project_path("CACHE_STORAGE_PATH", "data/cache")
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "500"))

DEFAULT_CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,http://172.20.16.1:3000"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]
# 开发环境自动允许局域网私有地址
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
