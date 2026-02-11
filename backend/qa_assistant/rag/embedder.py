"""
Embedding service for generating vector embeddings (query-time only).
"""

import hashlib
import json
import urllib.request
from collections import OrderedDict
from typing import List
import logging
import os

from core import config

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Service for generating text embeddings using OpenAI-compatible API."""

    def __init__(self, base_url: str, api_key: str, model: str,
                 cache_max_size: int = 256):
        """
        Initialize embedding service.

        Args:
            base_url: API base URL
            api_key: API key for authentication
            model: Embedding model name
            cache_max_size: Maximum number of embeddings to cache in memory
        """
        # Normalize base_url: ensure it ends with /v1
        base = base_url.rstrip("/")
        if not base.endswith("/v1"):
            base = base + "/v1"
        self.base_url = base
        self.api_key = api_key
        self.model = model
        self._cache: OrderedDict[str, List[float]] = OrderedDict()
        self._cache_max_size = cache_max_size

    def embed_text(self, text: str) -> List[float]:
        """
        Generate embedding for a single text (with LRU cache).

        Args:
            text: Text to embed

        Returns:
            Embedding vector as list of floats
        """
        import time
        start_time = time.perf_counter()

        # Check cache first
        cache_key = hashlib.sha256(
            text.strip().lower().encode("utf-8")
        ).hexdigest()

        if cache_key in self._cache:
            self._cache.move_to_end(cache_key)
            elapsed = (time.perf_counter() - start_time) * 1000
            logger.info(f"[TIMING] Embedding cache hit - took {elapsed:.2f}ms")
            return self._cache[cache_key]

        logger.info(f"[TIMING] Embedding API call starting for text length {len(text)}")
        api_start = time.perf_counter()

        endpoint = f"{self.base_url}/embeddings"
        payload = {
            "model": self.model,
            "input": text
        }

        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

        req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                body = response.read().decode("utf-8")
                result = json.loads(body)

            api_elapsed = (time.perf_counter() - api_start) * 1000
            logger.info(f"[TIMING] Embedding API call completed - took {api_elapsed:.2f}ms")

            embedding = result["data"][0]["embedding"]
            logger.debug(f"Generated embedding with dimension {len(embedding)}")

            # Store in cache, evict oldest if over limit
            self._cache[cache_key] = embedding
            if len(self._cache) > self._cache_max_size:
                self._cache.popitem(last=False)

            total_elapsed = (time.perf_counter() - start_time) * 1000
            logger.info(f"[TIMING] embed_text() total - took {total_elapsed:.2f}ms")
            return embedding

        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            raise

    def embed_batch(self, texts: List[str], batch_size: int = 100) -> List[List[float]]:
        """
        Generate embeddings for multiple texts in batches.

        Args:
            texts: List of texts to embed
            batch_size: Maximum texts per batch

        Returns:
            List of embedding vectors
        """
        all_embeddings = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            logger.info(f"Processing batch {i // batch_size + 1}/{(len(texts) + batch_size - 1) // batch_size}")

            endpoint = f"{self.base_url}/embeddings"
            payload = {
                "model": self.model,
                "input": batch
            }

            data = json.dumps(payload).encode("utf-8")
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}"
            }

            req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    body = response.read().decode("utf-8")
                    result = json.loads(body)

                data_items = result.get("data", [])
                if not data_items:
                    raise ValueError("Embedding API returned empty data")
                if isinstance(data_items[0], dict) and "index" in data_items[0]:
                    data_items = sorted(data_items, key=lambda item: item.get("index", 0))
                batch_embeddings = [item["embedding"] for item in data_items]
                all_embeddings.extend(batch_embeddings)

            except Exception as e:
                logger.error(f"Failed to generate batch embeddings: {e}")
                raise

        logger.info(f"Generated {len(all_embeddings)} embeddings")
        return all_embeddings


def create_embedding_service() -> EmbeddingService:
    """
    Create embedding service from environment variables.

    Returns:
        Configured EmbeddingService instance
    """
    base_url = os.getenv("HDMS_BASE_URL", "https://api.apiyi.com")
    api_key = os.getenv("HDMS_API_KEY", "")
    model = os.getenv("EMBEDDING_MODEL", config.EMBEDDING_MODEL)

    if not api_key:
        raise ValueError("HDMS_API_KEY environment variable is required")

    return EmbeddingService(
        base_url, api_key, model,
        cache_max_size=config.EMBEDDING_CACHE_MAX_SIZE,
    )
