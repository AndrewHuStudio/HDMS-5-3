"""
In-memory query result cache with TTL for the RAG pipeline.
Caches complete retrieval results + generated answers.
"""

import hashlib
import time
import threading
import logging
from collections import OrderedDict
from typing import Any, Optional

logger = logging.getLogger(__name__)


class QueryCache:
    """
    Thread-safe LRU cache with TTL for query results.

    Cache key: SHA-256 of normalized query text (strip + lowercase).
    History is NOT part of the key -- same question yields same retrieval.
    """

    def __init__(self, max_size: int = 128, ttl_seconds: int = 3600):
        self._cache: OrderedDict[str, dict] = OrderedDict()
        self._max_size = max_size
        self._ttl = ttl_seconds
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    @staticmethod
    def _make_key(query: str) -> str:
        normalized = query.strip().lower()
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def get(self, query: str) -> Optional[dict]:
        """Get cached result for query. Returns None on miss or expiry."""
        key = self._make_key(query)
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                self._misses += 1
                return None

            if time.time() - entry["timestamp"] > self._ttl:
                del self._cache[key]
                self._misses += 1
                logger.debug("Query cache expired for key %s", key[:12])
                return None

            self._cache.move_to_end(key)
            self._hits += 1
            logger.debug("Query cache hit for key %s", key[:12])
            return entry["value"]

    def put(self, query: str, result: dict) -> None:
        """Store result in cache."""
        key = self._make_key(query)
        with self._lock:
            self._cache[key] = {
                "value": result,
                "timestamp": time.time(),
            }
            self._cache.move_to_end(key)
            if len(self._cache) > self._max_size:
                evicted_key, _ = self._cache.popitem(last=False)
                logger.debug("Query cache evicted key %s", evicted_key[:12])

    def invalidate_all(self) -> None:
        """Clear entire cache."""
        with self._lock:
            self._cache.clear()
            logger.info("Query cache cleared")

    def get_stats(self) -> dict:
        """Return cache statistics."""
        with self._lock:
            total = self._hits + self._misses
            return {
                "size": len(self._cache),
                "max_size": self._max_size,
                "ttl_seconds": self._ttl,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": round(self._hits / total, 3) if total > 0 else 0,
            }


_query_cache: Optional[QueryCache] = None


def get_query_cache() -> QueryCache:
    """Get or create the global query cache singleton."""
    global _query_cache
    if _query_cache is None:
        from core import config
        _query_cache = QueryCache(
            max_size=config.QUERY_CACHE_MAX_SIZE,
            ttl_seconds=config.QUERY_CACHE_TTL_SECONDS,
        )
    return _query_cache
