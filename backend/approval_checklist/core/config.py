"""Configuration for approval checklist service."""

from __future__ import annotations

import os
from pathlib import Path


def _find_env_file() -> Path | None:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".env"
        if candidate.exists():
            return candidate
    return None


def _load_env_file() -> None:
    env_path = _find_env_file()
    if not env_path:
        return
    try:
        content = env_path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'").strip()
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file()

PROJECT_ROOT = Path(__file__).resolve().parents[3]
APP_ENV = os.getenv("APP_ENV", "development").lower()

REVIEW_SYSTEM_BASE_URL = os.getenv("REVIEW_SYSTEM_BASE_URL", "http://127.0.0.1:8003").rstrip("/")
MODEL_STORAGE_PATH = Path(
    os.getenv(
        "MODEL_STORAGE_PATH",
        str(PROJECT_ROOT / "data" / "uploads"),
    )
).resolve()
APPROVAL_RAW_RESULTS_ROOT = Path(
    os.getenv(
        "APPROVAL_RAW_RESULTS_ROOT",
        str(PROJECT_ROOT / "backend" / "approval_checklist" / "raw_results"),
    )
).resolve()

MONGODB_URI = os.getenv(
    "MONGODB_URI",
    "mongodb://admin:hdms2024@localhost:27019/hdms?authSource=admin",
)
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "hdms")
APPROVAL_DRAFT_COLLECTION = os.getenv("APPROVAL_DRAFT_COLLECTION", "approval_checklist_drafts")

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
