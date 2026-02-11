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

# Expanded concept keywords for broader graph search triggering
CONCEPT_KEYWORDS = {
    "performance": ["环境性能", "安全性能", "健康性能", "人本性能", "使用效能"],
    "perception": ["热舒适", "安全感", "归属感", "情绪健康", "地域性"],
    "spatial": ["街道空间", "绿地广场", "公共空间", "步行网络", "开放空间", "近地空间", "地下空间"],
    "standard": ["标准", "导则", "规范", "评估", "指标体系", "分类标准"],
    "research": ["研究发现", "相关性", "影响因素", "预测方法", "深度学习"],
    "guideline": ["设计导则", "管控要求", "实施手册", "开发建设"],
}


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
        use_keyword: bool = True,
        enable_rerank: bool = True,
    ) -> Dict[str, Any]:
        """
        Retrieve relevant information from multiple sources.

        Args:
            query: Query text
            top_k: Number of results to return
            use_vector: Whether to use vector search
            use_graph: Whether to use graph search
            use_keyword: Whether to use keyword search
            enable_rerank: Whether to apply reranking after fusion

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
        if enable_rerank and self.reranker and results["fused_results"]:
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
        import time
        start_time = time.perf_counter()

        # Generate query embedding
        embed_start = time.perf_counter()
        query_embedding = self.embedder.embed_text(query)
        embed_elapsed = (time.perf_counter() - embed_start) * 1000
        logger.info(f"[TIMING] Vector search - embedding took {embed_elapsed:.2f}ms")

        # Search in Milvus
        milvus_start = time.perf_counter()
        results = self.milvus.search(
            collection_name=self.collection_name,
            query_vector=query_embedding,
            top_k=top_k
        )
        milvus_elapsed = (time.perf_counter() - milvus_start) * 1000
        logger.info(f"[TIMING] Vector search - Milvus query took {milvus_elapsed:.2f}ms")

        # Add source and score
        for result in results:
            result["source"] = "vector"
            result["score"] = 1.0 - result.get("distance", 1.0)  # Convert distance to similarity

        total_elapsed = (time.perf_counter() - start_time) * 1000
        logger.info(f"[TIMING] Vector search total - {len(results)} results in {total_elapsed:.2f}ms")
        return results

    def _graph_search(self, query: str) -> List[Dict[str, Any]]:
        """
        Perform graph-based search with concept search and subgraph extraction.

        Returns ranked results plus a subgraph entry for visualization.
        """
        results = []
        seed_names: List[str] = []

        # 1. Plot ID search (existing logic, kept)
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
                    seed_names.append(plot_name)

        # 2. Indicator keyword search (existing logic, kept)
        for indicator in INDICATOR_KEYWORDS:
            if indicator in query:
                cypher = """
                MATCH (p:Plot)-[r:HAS_INDICATOR]->(i:Indicator {name: $indicator})
                RETURN p.name as plot_name, r.value as value
                LIMIT 5
                """
                indicator_results = self.graph_store.query_graph(
                    cypher, {"indicator": indicator}
                )
                if indicator_results:
                    results.append({
                        "source": "graph",
                        "type": "indicator_search",
                        "indicator": indicator,
                        "data": indicator_results,
                        "score": 0.8
                    })
                    seed_names.append(indicator)

        # 3. NEW: Concept search via full-text index
        try:
            concept_results = self.graph_store.search_concepts(query, limit=5)
            for concept in concept_results:
                score = concept.get("score", 0)
                if score > 0.3:
                    cname = concept.get("name", "")
                    if cname and cname not in seed_names:
                        seed_names.append(cname)
                        results.append({
                            "source": "graph",
                            "type": "concept_match",
                            "name": cname,
                            "node_type": concept.get("label", ""),
                            "data": concept.get("properties", {}),
                            "score": min(score * 0.7, 0.85),
                        })
        except Exception as e:
            logger.debug(f"Concept search skipped: {e}")

        # 4. NEW: Extract subgraph for visualization (not ranked)
        if seed_names:
            try:
                subgraph = self.graph_store.get_subgraph(
                    seed_names=seed_names[:5],
                    max_depth=2,
                    max_nodes=30,
                )
                if subgraph.get("nodes"):
                    results.append({
                        "source": "graph",
                        "type": "subgraph",
                        "data": subgraph,
                        "score": 0.0,  # Not ranked, visualization only
                    })
            except Exception as e:
                logger.debug(f"Subgraph extraction skipped: {e}")

        logger.info(f"Graph search returned {len(results)} results (seeds: {seed_names[:3]})")
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
        - Concept keyword detected: moderate graph boost
        - Default: vector dominates
        """
        has_plot_id = bool(PLOT_PATTERN.search(query))
        has_indicator = any(kw in query for kw in INDICATOR_KEYWORDS)
        has_concept = any(
            kw in query
            for keywords in CONCEPT_KEYWORDS.values()
            for kw in keywords
        )

        if has_plot_id:
            return {"vector": 0.25, "graph": 0.55, "keyword": 0.20}
        elif has_indicator:
            return {"vector": 0.30, "graph": 0.50, "keyword": 0.20}
        elif has_concept:
            return {"vector": 0.35, "graph": 0.40, "keyword": 0.25}
        else:
            return {"vector": 0.50, "graph": 0.25, "keyword": 0.25}

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

        # Filter out subgraph/concept_match entries before fusion (visualization only)
        graph_results = [
            r for r in graph_results
            if r.get("type") not in ("subgraph", "concept_match")
        ]

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
        Numbering [1], [2], ... follows fused_results order so citations align
        with source extraction in RAGService.

        Args:
            results: Results from retrieve()

        Returns:
            Formatted context string
        """
        context = ""
        idx = 1

        ranked_results = results.get("fused_results") or []
        if not ranked_results:
            ranked_results = [
                *results.get("vector_results", []),
                *results.get("graph_results", []),
                *results.get("keyword_results", []),
            ]

        seen_doc_keys: set[str] = set()
        seen_graph_keys: set[str] = set()
        doc_blocks: List[str] = []
        graph_blocks: List[str] = []

        for result in ranked_results:
            source_type = str(result.get("source") or "")
            result_type = str(result.get("type") or "")
            is_graph = source_type == "graph" or result_type in {"plot_info", "indicator_search"}

            if is_graph:
                if result_type == "plot_info":
                    plot_name = str(result.get("plot_name") or "").strip()
                    if not plot_name or plot_name in seen_graph_keys:
                        continue
                    seen_graph_keys.add(plot_name)
                    data = result.get("data", {}) or {}
                    lines = [f"[{idx}] 地块 {plot_name}："]
                    indicators = data.get("indicators", []) if isinstance(data, dict) else []
                    if indicators:
                        lines.append("指标：")
                        for ind in indicators[:6]:
                            if ind.get("indicator"):
                                lines.append(f"  - {ind['indicator']}: {ind.get('value', '未指定')}")
                    graph_blocks.append("\n".join(lines))
                    idx += 1
                    continue

                indicator = str(result.get("indicator") or "").strip()
                graph_key = f"indicator:{indicator}" if indicator else f"graph:{len(graph_blocks)}"
                if graph_key in seen_graph_keys:
                    continue
                seen_graph_keys.add(graph_key)

                data = result.get("data", [])
                lines = [f"[{idx}] 指标查询：{indicator or '图谱结果'}"]
                if isinstance(data, list):
                    for item in data[:5]:
                        plot_name = item.get("plot_name") if isinstance(item, dict) else None
                        value = item.get("value") if isinstance(item, dict) else None
                        if plot_name:
                            lines.append(f"  - {plot_name}: {value if value is not None else '未指定'}")
                graph_blocks.append("\n".join(lines))
                idx += 1
                continue

            metadata = result.get("metadata", {}) or {}
            chunk_id = str(result.get("id") or result.get("_id") or "").strip()
            text = str(result.get("text", "") or "").strip()
            if not text:
                continue

            dedup_key = chunk_id or text[:120]
            if dedup_key in seen_doc_keys:
                continue
            seen_doc_keys.add(dedup_key)

            file_name = (
                metadata.get("file_name")
                or result.get("file_name")
                or "未知文档"
            )
            section = (
                metadata.get("section_title")
                or result.get("section_title")
                or ""
            )
            section_label = f" - {section}" if section else ""

            display_text = text[:1200]
            if len(text) > 1200:
                display_text += "..."

            doc_blocks.append(f"[{idx}] 来源：{file_name}{section_label}\n{display_text}")
            idx += 1

        if doc_blocks:
            context += "## 相关文档内容\n\n"
            context += "\n\n".join(doc_blocks)
            context += "\n\n"

        if graph_blocks:
            context += "## 知识图谱信息\n\n"
            context += "\n\n".join(graph_blocks)
            context += "\n\n"

        return context
