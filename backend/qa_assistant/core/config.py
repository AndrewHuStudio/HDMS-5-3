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

APP_ENV = os.getenv("APP_ENV", "development").lower()

# --- Database Configuration ---
MILVUS_HOST = os.getenv("MILVUS_HOST", "localhost")
MILVUS_PORT = int(os.getenv("MILVUS_PORT", "19532"))
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://admin:hdms2024@localhost:27019/hdms?authSource=admin")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "hdms")
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7689")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "hdms2024")

# --- Embedding Configuration ---
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-large")
_EMBEDDING_DIMENSION_ENV = os.getenv("EMBEDDING_DIMENSION", "").strip()
_EMBEDDING_DIMENSION_BY_MODEL = {
    "text-embedding-3-large": 3072,
    "text-embedding-3-small": 1536,
    "text-embedding-ada-002": 1536,
}
if _EMBEDDING_DIMENSION_ENV:
    EMBEDDING_DIMENSION = int(_EMBEDDING_DIMENSION_ENV)
else:
    EMBEDDING_DIMENSION = _EMBEDDING_DIMENSION_BY_MODEL.get(EMBEDDING_MODEL, 3072)

# --- Milvus Collections ---
MILVUS_COLLECTION_TEXT = os.getenv("MILVUS_COLLECTION_TEXT", "hdms_text_chunks")
MILVUS_RECREATE_ON_MISMATCH = os.getenv("MILVUS_RECREATE_ON_MISMATCH", "0").strip().lower() in {"1", "true", "yes"}
MILVUS_DIMENSION_STRICT = os.getenv("MILVUS_DIMENSION_STRICT", "1").strip().lower() in {"1", "true", "yes"}

# --- Database initialization behavior ---
_DB_INIT_ASYNC_ENV = os.getenv("DB_INIT_ASYNC", "").strip().lower()
if _DB_INIT_ASYNC_ENV:
    DB_INIT_ASYNC = _DB_INIT_ASYNC_ENV in {"1", "true", "yes"}
else:
    DB_INIT_ASYNC = APP_ENV == "development"
DB_INIT_ON_STARTUP = os.getenv("DB_INIT_ON_STARTUP", "1").strip().lower() in {"1", "true", "yes"}

# --- LLM Configuration ---
HDMS_BASE_URL = os.getenv("HDMS_BASE_URL", "https://api.apiyi.com")
HDMS_API_KEY = os.getenv("HDMS_API_KEY", "")
HDMS_MODEL = os.getenv("HDMS_MODEL", "deepseek-v3")

# --- CORS Configuration ---
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
