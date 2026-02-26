"""
问答助手配置
从 .env 文件和环境变量读取数据库连接、LLM、嵌入模型、CORS、缓存等全局配置。
"""
from __future__ import annotations

import os
from pathlib import Path


def _parse_bool(value: str, default: bool) -> bool:
    """将字符串解析为布尔值，空值返回 default"""
    text = (value or "").strip().lower()
    if not text:
        return default
    return text in {"1", "true", "yes"}


def _parse_int(value: str, default: int, *, min_value: int | None = None, max_value: int | None = None) -> int:
    """将字符串解析为整数，支持范围限制"""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    if min_value is not None and parsed < min_value:
        return min_value
    if max_value is not None and parsed > max_value:
        return max_value
    return parsed


def _parse_float(
    value: str,
    default: float,
    *,
    min_value: float | None = None,
    max_value: float | None = None,
) -> float:
    """将字符串解析为浮点数，支持范围限制"""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    if min_value is not None and parsed < min_value:
        return min_value
    if max_value is not None and parsed > max_value:
        return max_value
    return parsed


def _find_env_file() -> Path | None:
    """向上遍历目录树，找到包含 .env 文件的目录"""
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".env"
        if candidate.exists():
            return candidate
    return None


def _load_env_file() -> None:
    """读取 .env 文件并将未设置的键写入 os.environ（不覆盖已有环境变量）"""
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
MILVUS_PORT = _parse_int(os.getenv("MILVUS_PORT", "19532"), 19532, min_value=1)
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
    EMBEDDING_DIMENSION = _parse_int(_EMBEDDING_DIMENSION_ENV, 3072, min_value=1)
else:
    EMBEDDING_DIMENSION = _EMBEDDING_DIMENSION_BY_MODEL.get(EMBEDDING_MODEL, 3072)

# --- Milvus Collections ---
MILVUS_COLLECTION_TEXT = os.getenv("MILVUS_COLLECTION_TEXT", "hdms_text_chunks")
MILVUS_RECREATE_ON_MISMATCH = _parse_bool(os.getenv("MILVUS_RECREATE_ON_MISMATCH", "0"), False)
MILVUS_DIMENSION_STRICT = _parse_bool(os.getenv("MILVUS_DIMENSION_STRICT", "1"), True)

# --- Database initialization behavior ---
_DB_INIT_ASYNC_ENV = os.getenv("DB_INIT_ASYNC", "").strip().lower()
if _DB_INIT_ASYNC_ENV:
    DB_INIT_ASYNC = _parse_bool(_DB_INIT_ASYNC_ENV, APP_ENV == "development")
else:
    DB_INIT_ASYNC = APP_ENV == "development"
DB_INIT_ON_STARTUP = _parse_bool(os.getenv("DB_INIT_ON_STARTUP", "1"), True)

# --- LLM Configuration ---
HDMS_BASE_URL = os.getenv("HDMS_BASE_URL", "https://api.apiyi.com")
HDMS_API_KEY = os.getenv("HDMS_API_KEY", "")
HDMS_QA_MODEL = os.getenv("HDMS_QA_MODEL", "deepseek-r1")

# --- CORS Configuration ---
DEFAULT_CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,http://172.20.16.1:3000"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]
CORS_ALLOW_PRIVATE_ORIGINS = os.getenv(
    "CORS_ALLOW_PRIVATE_ORIGINS", "1" if APP_ENV == "development" else "0"
)
CORS_ALLOW_PRIVATE_ORIGINS = _parse_bool(CORS_ALLOW_PRIVATE_ORIGINS, APP_ENV == "development")
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

# --- Embedding Cache ---
EMBEDDING_CACHE_MAX_SIZE = _parse_int(os.getenv("EMBEDDING_CACHE_MAX_SIZE", "256"), 256, min_value=1)

# --- Query Cache ---
QUERY_CACHE_ENABLED = _parse_bool(os.getenv("QUERY_CACHE_ENABLED", "1"), True)
QUERY_CACHE_MAX_SIZE = _parse_int(os.getenv("QUERY_CACHE_MAX_SIZE", "128"), 128, min_value=1)
QUERY_CACHE_TTL_SECONDS = _parse_int(os.getenv("QUERY_CACHE_TTL_SECONDS", "3600"), 3600, min_value=1)

# --- Streaming latency tuning ---
STREAM_ENABLE_RERANK = _parse_bool(os.getenv("STREAM_ENABLE_RERANK", "0"), False)
QA_RETRIEVAL_MODES = {
    "vector",
    "vector_only",
    "vector_keyword",
    "keyword_vector",
    "hybrid",
    "all",
    "none",
    "off",
    "disabled",
}
QA_RETRIEVAL_MODE = os.getenv("QA_RETRIEVAL_MODE", "hybrid").strip().lower()
STREAM_RETRIEVAL_MODE = os.getenv("STREAM_RETRIEVAL_MODE", "").strip().lower() or QA_RETRIEVAL_MODE
STREAM_RETRIEVAL_TOP_K_CAP = _parse_int(
    os.getenv("STREAM_RETRIEVAL_TOP_K_CAP", os.getenv("QA_TOP_K_MAX", "20")),
    20,
    min_value=1,
)
SUMMARY_REASON_LLM_REWRITE = _parse_bool(os.getenv("SUMMARY_REASON_LLM_REWRITE", "1"), True)
STREAM_RETRIEVAL_MODES = QA_RETRIEVAL_MODES

# --- QA Runtime Configuration ---
QA_TOP_K_MIN = _parse_int(os.getenv("QA_TOP_K_MIN", "1"), 1, min_value=1)
QA_TOP_K_MAX = _parse_int(
    os.getenv("QA_TOP_K_MAX", "20"),
    20,
    min_value=QA_TOP_K_MIN,
)
QA_DEFAULT_TOP_K = _parse_int(
    os.getenv("QA_DEFAULT_TOP_K", "5"),
    5,
    min_value=QA_TOP_K_MIN,
    max_value=QA_TOP_K_MAX,
)
QA_IMAGE_BOOST_LIMIT = _parse_int(
    os.getenv("QA_IMAGE_BOOST_LIMIT", "4"),
    4,
    min_value=1,
    max_value=QA_TOP_K_MAX,
)
QA_HISTORY_WINDOW = _parse_int(os.getenv("QA_HISTORY_WINDOW", "8"), 8, min_value=1, max_value=100)
QA_FEEDBACK_ANSWER_MAX_CHARS = _parse_int(
    os.getenv("QA_FEEDBACK_ANSWER_MAX_CHARS", "2000"),
    2000,
    min_value=1,
)
QA_FEEDBACK_ID_MESSAGE_PREFIX_LEN = _parse_int(
    os.getenv("QA_FEEDBACK_ID_MESSAGE_PREFIX_LEN", "8"),
    8,
    min_value=1,
    max_value=64,
)
QA_LLM_TEMPERATURE = _parse_float(os.getenv("QA_LLM_TEMPERATURE", "0.3"), 0.3, min_value=0.0, max_value=2.0)
QA_LLM_MAX_TOKENS = _parse_int(os.getenv("QA_LLM_MAX_TOKENS", "4096"), 4096, min_value=1)
QA_LLM_TIMEOUT_SECONDS = _parse_int(os.getenv("QA_LLM_TIMEOUT_SECONDS", "60"), 60, min_value=1)
QA_STREAM_MAX_TOKENS = _parse_int(os.getenv("QA_STREAM_MAX_TOKENS", "4096"), 4096, min_value=1)
QA_CONTEXT_CHUNK_MAX_CHARS = _parse_int(os.getenv("QA_CONTEXT_CHUNK_MAX_CHARS", "0"), 0, min_value=0)
QA_CONTEXT_QUOTE_MAX_CHARS = _parse_int(os.getenv("QA_CONTEXT_QUOTE_MAX_CHARS", "260"), 260, min_value=0)


# --- Rerank Configuration ---
RERANK_ENABLED = _parse_bool(os.getenv("RERANK_ENABLED", "false"), False)
RERANK_BASE_URL = os.getenv("RERANK_BASE_URL", "https://api.apiyi.com/v1")
RERANK_API_KEY = os.getenv("RERANK_API_KEY", "")
RERANK_MODEL = os.getenv("RERANK_MODEL", "bge-reranker-v2-m3")
RERANK_TOP_N = _parse_int(os.getenv("RERANK_TOP_N", "5"), 5, min_value=1)
