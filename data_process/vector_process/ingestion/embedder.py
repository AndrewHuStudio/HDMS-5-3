"""
Embedding service for generating vector embeddings.
"""

import json
from json import JSONDecodeError
import urllib.request
import urllib.error
from typing import List, Dict, Any
import logging
import os

from ...core import config

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

    def _embedding_endpoints(self) -> List[str]:
        endpoints = [f"{self.base_url}/embeddings"]
        if not self.base_url.endswith("/v1"):
            endpoints.append(f"{self.base_url}/v1/embeddings")

        unique: List[str] = []
        seen: set[str] = set()
        for endpoint in endpoints:
            if endpoint in seen:
                continue
            seen.add(endpoint)
            unique.append(endpoint)
        return unique

    def _request_embeddings(self, payload: Dict[str, Any], timeout: int) -> Dict[str, Any]:
        errors: List[str] = []

        for endpoint in self._embedding_endpoints():
            data = json.dumps(payload).encode("utf-8")
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}"
            }
            req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

            try:
                with urllib.request.urlopen(req, timeout=timeout) as response:
                    body_bytes = response.read()
                    body = body_bytes.decode("utf-8", errors="replace")
                    content_type = (response.headers.get("Content-Type") or "").lower()

                try:
                    result = json.loads(body)
                except JSONDecodeError:
                    preview = body.strip().replace("\n", " ")[:200]
                    errors.append(
                        f"{endpoint} returned non-JSON response (Content-Type={content_type or 'unknown'}): {preview}"
                    )
                    continue

                if not isinstance(result, dict) or "data" not in result:
                    preview = str(result)[:200]
                    errors.append(f"{endpoint} returned unexpected payload: {preview}")
                    continue

                return result

            except urllib.error.HTTPError as exc:
                try:
                    body = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    body = ""
                preview = body.strip().replace("\n", " ")[:200]
                errors.append(f"{endpoint} HTTP {exc.code}: {preview}")
            except Exception as exc:
                errors.append(f"{endpoint} request error: {exc}")

        raise RuntimeError("Embedding API request failed. " + " | ".join(errors))

    def embed_text(self, text: str) -> List[float]:
        """
        Generate embedding for a single text.

        Args:
            text: Text to embed

        Returns:
            Embedding vector as list of floats
        """
        payload = {
            "model": self.model,
            "input": text
        }

        try:
            result = self._request_embeddings(payload, timeout=30)
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

        # Process in batches
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            logger.info(f"Processing batch {i // batch_size + 1}/{(len(texts) + batch_size - 1) // batch_size}")

            payload = {
                "model": self.model,
                "input": batch
            }

            try:
                result = self._request_embeddings(payload, timeout=60)

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
