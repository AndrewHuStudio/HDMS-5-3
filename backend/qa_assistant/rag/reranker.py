"""
Reranker module that calls an external Rerank API (e.g. DMXAPI / Jina / Cohere)
to re-score fused retrieval results before they are sent to the LLM.
"""

from __future__ import annotations

import json
import logging
import urllib.request
from typing import Any, Dict, List

from core import config as app_config

logger = logging.getLogger(__name__)


class Reranker:
    """Calls a Rerank API that follows the Cohere / DMXAPI rerank interface."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        top_n: int | None = None,
    ):
        self.base_url = (base_url or app_config.RERANK_BASE_URL).rstrip("/")
        self.api_key = api_key or app_config.RERANK_API_KEY
        self.model = model or app_config.RERANK_MODEL
        self.top_n = top_n if top_n is not None else app_config.RERANK_TOP_N

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_n: int | None = None,
    ) -> List[Dict[str, Any]]:
        """
        Re-rank *documents* with respect to *query*.

        Each document dict **must** contain a ``"text"`` key (the passage to
        score).  The method returns a **new** list sorted by relevance, each
        item enriched with ``rerank_score``.

        If the API call fails the original list is returned unchanged so that
        the pipeline degrades gracefully.
        """
        if not documents:
            return documents

        effective_top_n = top_n if top_n is not None else self.top_n

        # Build the list of plain-text passages for the API
        passages: List[str] = []
        for doc in documents:
            text = doc.get("text", "")
            if not text:
                # Fallback: try to build a string from graph data
                data = doc.get("data")
                if isinstance(data, dict):
                    text = json.dumps(data, ensure_ascii=False)[:512]
                elif isinstance(data, list):
                    text = json.dumps(data, ensure_ascii=False)[:512]
                else:
                    text = str(doc)[:512]
            passages.append(text[:512])  # Truncate to avoid token limits

        try:
            ranked_indices = self._call_api(query, passages, effective_top_n)
        except Exception as exc:
            logger.warning("Rerank API call failed, falling back to original order: %s", exc)
            return documents[:effective_top_n]

        # Re-order documents according to API response
        reranked: List[Dict[str, Any]] = []
        for idx, score in ranked_indices:
            if 0 <= idx < len(documents):
                doc = dict(documents[idx])
                doc["rerank_score"] = score
                reranked.append(doc)

        logger.info(
            "Reranked %d -> %d documents (model=%s)",
            len(documents),
            len(reranked),
            self.model,
        )
        return reranked

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _call_api(
        self,
        query: str,
        passages: List[str],
        top_n: int,
    ) -> List[tuple[int, float]]:
        """
        Call the rerank endpoint and return a list of ``(original_index, score)``
        tuples sorted by descending relevance.
        """
        endpoint = f"{self.base_url}/rerank"

        payload = {
            "model": self.model,
            "query": query,
            "documents": passages,
            "top_n": top_n,
        }

        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))

        # The response follows the Cohere / DMXAPI format:
        # { "results": [ {"index": 0, "relevance_score": 0.95}, ... ] }
        results = body.get("results", [])
        return [
            (item["index"], item.get("relevance_score", 0.0))
            for item in results
        ]
