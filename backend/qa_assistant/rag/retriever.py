"""
Multi-source retriever for RAG system.
"""

from __future__ import annotations

import re
from typing import List, Dict, Any, Optional
import logging

from core import config as app_config
from core.database.milvus_client import MilvusClient
from core.database.mongodb_client import MongoDBClient
from rag.graph_query import GraphQueryService
from rag.embedder import EmbeddingService
from rag.reranker import Reranker

logger = logging.getLogger(__name__)

# Shared patterns for query analysis
PLOT_PATTERN = re.compile(r'DU\d{2}-\d{2}(?:-\d+)?')
INDICATOR_KEYWORDS = ["容积率", "建筑限高", "建筑密度", "绿地率", "退线", "停车"]


class MultiSourceRetriever:
    """Retriever that combines results from multiple sources."""

    def __init__(
        self,
        milvus_client: MilvusClient,
        mongodb_client: MongoDBClient,
        graph_store: GraphQueryService,
        embedder: EmbeddingService,
        collection_name: str = "hdms_text_chunks",
        reranker: Optional[Reranker] = None,
    ):
        self.milvus = milvus_client
        self.mongodb = mongodb_client
        self.graph_store = graph_store
        self.embedder = embedder
        self.collection_name = collection_name

        # Reranker: use the provided instance, or auto-create when enabled
        if reranker is not None:
            self.reranker = reranker
        elif app_config.RERANK_ENABLED and app_config.RERANK_API_KEY:
            self.reranker = Reranker()
        else:
            self.reranker = None

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        use_vector: bool = True,
        use_graph: bool = True,
        use_keyword: bool = True
    ) -> Dict[str, Any]:
        """
        Retrieve relevant information from multiple sources.

        Args:
            query: Query text
            top_k: Number of results to return
            use_vector: Whether to use vector search
            use_graph: Whether to use graph search
            use_keyword: Whether to use keyword search

        Returns:
            Dictionary with results from each source
        """
        results = {
            "vector_results": [],
            "graph_results": [],
            "keyword_results": [],
            "fused_results": []
        }

        # Vector search
        if use_vector:
            try:
                results["vector_results"] = self._vector_search(query, top_k)
            except Exception as e:
                logger.error(f"Vector search failed: {e}")

        # Graph search
        if use_graph:
            try:
                results["graph_results"] = self._graph_search(query)
            except Exception as e:
                logger.error(f"Graph search failed: {e}")

        # Keyword search
        if use_keyword:
            try:
                results["keyword_results"] = self._keyword_search(query, top_k)
            except Exception as e:
                logger.error(f"Keyword search failed: {e}")

        # Fuse results
        results["fused_results"] = self._fuse_results(
            results["vector_results"],
            results["graph_results"],
            results["keyword_results"],
            top_k,
            query=query
        )

        # Rerank fused results if reranker is available
        results["reranked"] = False
        if self.reranker and results["fused_results"]:
            try:
                reranked = self.reranker.rerank(
                    query=query,
                    documents=results["fused_results"],
                    top_n=top_k,
                )
                results["fused_results"] = reranked
                results["reranked"] = True
                logger.info("Rerank applied successfully (%d results)", len(reranked))
            except Exception as exc:
                logger.warning("Rerank failed, keeping original fusion order: %s", exc)

        return results

    def _vector_search(self, query: str, top_k: int) -> List[Dict[str, Any]]:
        """
        Perform vector similarity search.

        Args:
            query: Query text
            top_k: Number of results

        Returns:
            List of search results
        """
        # Generate query embedding
        query_embedding = self.embedder.embed_text(query)

        # Search in Milvus
        results = self.milvus.search(
            collection_name=self.collection_name,
            query_vector=query_embedding,
            top_k=top_k
        )

        # Add source and score
        for result in results:
            result["source"] = "vector"
            result["score"] = 1.0 - result.get("distance", 1.0)  # Convert distance to similarity

        logger.info(f"Vector search returned {len(results)} results")
        return results

    def _graph_search(self, query: str) -> List[Dict[str, Any]]:
        """Perform graph-based search."""
        results = []

        # Extract plot names from query
        plots = PLOT_PATTERN.findall(query)

        if plots:
            for plot_name in plots:
                info = self.graph_store.get_plot_info(plot_name)
                if info:
                    results.append({
                        "source": "graph",
                        "type": "plot_info",
                        "plot_name": plot_name,
                        "data": info,
                        "score": 0.9
                    })

        # Extract indicator keywords
        for indicator in INDICATOR_KEYWORDS:
            if indicator in query:
                # Find plots with this indicator
                cypher = """
                MATCH (p:Plot)-[r:HAS_INDICATOR]->(i:Indicator {name: $indicator})
                RETURN p.name as plot_name, r.value as value
                LIMIT 5
                """
                indicator_results = self.graph_store.query_graph(
                    cypher,
                    {"indicator": indicator}
                )

                if indicator_results:
                    results.append({
                        "source": "graph",
                        "type": "indicator_search",
                        "indicator": indicator,
                        "data": indicator_results,
                        "score": 0.8
                    })

        logger.info(f"Graph search returned {len(results)} results")
        return results

    def _keyword_search(self, query: str, top_k: int) -> List[Dict[str, Any]]:
        """
        Perform keyword-based search in MongoDB.

        Args:
            query: Query text
            top_k: Number of results

        Returns:
            List of search results
        """
        try:
            # Search in chunks collection
            results = self.mongodb.text_search(
                "chunks",
                query,
                limit=top_k
            )

            # Add source and score
            for result in results:
                result["source"] = "keyword"
                result["score"] = result.get("score", 0.5)

            logger.info(f"Keyword search returned {len(results)} results")
            return results

        except Exception as e:
            logger.warning(f"Keyword search not available: {e}")
            return []

    @staticmethod
    def _normalize_scores(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Normalize scores to [0, 1] range using min-max normalization."""
        if not results:
            return results
        scores = [r.get("score", 0) for r in results]
        min_s, max_s = min(scores), max(scores)
        spread = max_s - min_s
        normalized = []
        for r in results:
            r_copy = dict(r)
            if spread > 0:
                r_copy["score"] = (r_copy.get("score", 0) - min_s) / spread
            else:
                r_copy["score"] = 1.0
            normalized.append(r_copy)
        return normalized

    def _compute_weights(self, query: str) -> Dict[str, float]:
        """
        Compute dynamic fusion weights based on query characteristics.

        - Plot ID detected (DU01-01): boost graph weight
        - Indicator keyword detected: moderate graph boost
        - Default: vector dominates
        """
        has_plot_id = bool(PLOT_PATTERN.search(query))
        has_indicator = any(kw in query for kw in INDICATOR_KEYWORDS)

        if has_plot_id:
            return {"vector": 0.25, "graph": 0.55, "keyword": 0.20}
        elif has_indicator:
            return {"vector": 0.35, "graph": 0.45, "keyword": 0.20}
        else:
            return {"vector": 0.55, "graph": 0.20, "keyword": 0.25}

    def _fuse_results(
        self,
        vector_results: List[Dict[str, Any]],
        graph_results: List[Dict[str, Any]],
        keyword_results: List[Dict[str, Any]],
        top_k: int,
        query: str = ""
    ) -> List[Dict[str, Any]]:
        """
        Fuse results from multiple sources using normalized scores
        and dynamic weights based on query type.
        """
        weights = self._compute_weights(query) if query else {
            "vector": 0.5, "graph": 0.3, "keyword": 0.2
        }
        logger.info(f"Fusion weights: {weights}")

        # Normalize scores per source before weighting
        vector_results = self._normalize_scores(list(vector_results))
        graph_results = self._normalize_scores(list(graph_results))
        keyword_results = self._normalize_scores(list(keyword_results))

        # Combine all results with weighted scores
        all_results = []

        for result in vector_results:
            all_results.append({
                **result,
                "weighted_score": result.get("score", 0) * weights["vector"]
            })

        for result in graph_results:
            all_results.append({
                **result,
                "weighted_score": result.get("score", 0) * weights["graph"]
            })

        for result in keyword_results:
            all_results.append({
                **result,
                "weighted_score": result.get("score", 0) * weights["keyword"]
            })

        # Sort by weighted score
        all_results.sort(key=lambda x: x.get("weighted_score", 0), reverse=True)

        # Deduplicate based on chunk_id or text
        seen = set()
        fused_results = []

        for result in all_results:
            if "id" in result:
                key = result["id"]
            elif "text" in result:
                key = result["text"][:100]
            else:
                key = str(result)

            if key not in seen:
                seen.add(key)
                fused_results.append(result)

            if len(fused_results) >= top_k:
                break

        logger.info(f"Fused results: {len(fused_results)} unique items")
        return fused_results

    def format_context(self, results: Dict[str, Any]) -> str:
        """
        Format retrieval results into context string for LLM.
        Numbering [1], [2], ... matches the order of sources extracted by
        RAGService._extract_sources so inline citations align correctly.
        Uses the same dedup logic (by chunk id) as _extract_sources.

        Args:
            results: Results from retrieve()

        Returns:
            Formatted context string
        """
        context = ""
        idx = 1  # global counter across all source types
        seen_ids: set = set()

        # Add vector results (dedup by chunk id, same as _extract_sources)
        vector_results = results.get("vector_results", [])
        if vector_results:
            context += "## 相关文档内容\n\n"
            for result in vector_results[:5]:
                chunk_id = result.get("id", "")
                if not chunk_id or chunk_id in seen_ids:
                    continue
                seen_ids.add(chunk_id)

                text = result.get("text", "")
                metadata = result.get("metadata", {})
                file_name = metadata.get("file_name", "未知文档")
                section = metadata.get("section_title", "")
                section_label = f" - {section}" if section else ""
                # Keep more text for better context (up to 800 chars)
                display_text = text[:800]
                if len(text) > 800:
                    display_text += "..."
                context += f"[{idx}] 来源：{file_name}{section_label}\n{display_text}\n\n"
                idx += 1

        # Add graph results (dedup by plot_name, same as _extract_sources)
        graph_results = results.get("graph_results", [])
        if graph_results:
            context += "## 知识图谱信息\n\n"
            for result in graph_results:
                if result.get("type") == "plot_info":
                    plot_name = result.get("plot_name", "")
                    if not plot_name or plot_name in seen_ids:
                        continue
                    seen_ids.add(plot_name)

                    data = result.get("data", {})
                    context += f"[{idx}] 地块 {plot_name}：\n"

                    indicators = data.get("indicators", [])
                    if indicators:
                        context += "指标：\n"
                        for ind in indicators[:5]:
                            if ind.get("indicator"):
                                context += f"  - {ind['indicator']}: {ind.get('value', '未指定')}\n"
                    context += "\n"
                    idx += 1

        return context
