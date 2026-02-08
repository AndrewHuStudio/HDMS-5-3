"""
Embedding service for generating vector embeddings (query-time only).
"""

import json
import urllib.request
from typing import List
import logging
import os

from core import config

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Service for generating text embeddings using OpenAI-compatible API."""

    def __init__(self, base_url: str, api_key: str, model: str):
        """
        Initialize embedding service.

        Args:
            base_url: API base URL
            api_key: API key for authentication
            model: Embedding model name
        """
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    def embed_text(self, text: str) -> List[float]:
        """
        Generate embedding for a single text.

        Args:
            text: Text to embed

        Returns:
            Embedding vector as list of floats
        """
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

            embedding = result["data"][0]["embedding"]
            logger.debug(f"Generated embedding with dimension {len(embedding)}")
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

    return EmbeddingService(base_url, api_key, model)
