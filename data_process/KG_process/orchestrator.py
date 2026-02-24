"""
Knowledge graph orchestrator module.

Coordinates the full pipeline: graph construction (extraction) + fusion.
Provides a single entry point for both first-time builds and incremental updates.
"""

import logging
from typing import Dict, Any, Optional, List

from ..core.database.mongodb_client import MongoDBClient
from ..core.database.neo4j_client import Neo4jClient
from .graph_store import GraphStoreService, create_graph_store_service
from .graph.builder import GraphBuilder
from .fusion import GraphFusionService, create_fusion_service

logger = logging.getLogger(__name__)


class KGOrchestrator:
    """Orchestrates knowledge graph construction and fusion pipeline.

    Usage:
        # First-time: build all documents then fuse
        orchestrator.run_full_pipeline()

        # Incremental: add new documents, build, then fuse against existing graph
        orchestrator.run_incremental_pipeline(doc_ids=["doc1", "doc2"])
    """

    def __init__(
        self,
        mongodb_client: MongoDBClient,
        neo4j_client: Neo4jClient,
        graph_store: GraphStoreService,
        fusion_service: GraphFusionService,
    ):
        self.builder = GraphBuilder(mongodb_client, graph_store)
        self.fusion = fusion_service
        self.neo4j = neo4j_client

    # ------------------------------------------------------------------
    # Helper: collect entity IDs created during a build
    # ------------------------------------------------------------------

    def _get_entity_count(self) -> int:
        """Get current total entity count for tracking new entities."""
        rows = self.neo4j.query("MATCH (n) RETURN count(n) AS cnt")
        return rows[0]["cnt"] if rows else 0

    def _get_recent_entity_ids(self, known_ids_before: set) -> List[str]:
        """Get entity IDs that were created after a build (not in known_ids_before)."""
        rows = self.neo4j.query(
            "MATCH (n) WHERE NOT n:Document RETURN elementId(n) AS id"
        )
        all_ids = {r["id"] for r in rows}
        new_ids = all_ids - known_ids_before
        return list(new_ids)

    def _snapshot_entity_ids(self) -> set:
        """Take a snapshot of all current entity IDs (excluding Document nodes)."""
        rows = self.neo4j.query(
            "MATCH (n) WHERE NOT n:Document RETURN elementId(n) AS id"
        )
        return {r["id"] for r in rows}

    # ------------------------------------------------------------------
    # Full pipeline
    # ------------------------------------------------------------------

    def run_full_pipeline(
        self,
        use_llm: bool = True,
        max_docs: Optional[int] = None,
        skip_built: bool = False,
        force_rebuild: bool = False,
    ) -> Dict[str, Any]:
        """
        Run the complete pipeline: build all documents -> full fusion.

        Steps:
        1. Build knowledge graph from all documents in MongoDB
        2. Run full fusion (entity disambiguation + cross-doc relation discovery)

        Args:
            use_llm: Whether to use LLM for extraction
            max_docs: Max documents to process (None for all)

        Returns:
            Combined result dict with build and fusion summaries.
        """
        logger.info("========== KG Full Pipeline: START ==========")

        # Step 1: Build
        logger.info("[Pipeline Step 1/2] Building graph from all documents...")
        build_result = self.builder.build_from_all_documents(
            use_llm=use_llm,
            max_docs=max_docs,
            skip_built=skip_built,
            force_rebuild=force_rebuild,
        )
        logger.info(
            f"[Pipeline Step 1/2] Build complete: "
            f"{build_result['success']}/{build_result['total']} documents succeeded"
        )

        # Step 2: Fuse
        logger.info("[Pipeline Step 2/2] Running full fusion...")
        fusion_result = self.fusion.fuse_full()
        logger.info(
            f"[Pipeline Step 2/2] Fusion complete: "
            f"{fusion_result['disambiguation']['total_merged']} merged, "
            f"{fusion_result['cross_doc_relations']['discovered']} relations discovered"
        )

        summary = {
            "mode": "full_pipeline",
            "build": {
                "total": build_result["total"],
                "success": build_result["success"],
                "failed": build_result["failed"],
            },
            "fusion": fusion_result,
            "status": "success",
        }

        logger.info("========== KG Full Pipeline: DONE ==========")
        return summary

    # ------------------------------------------------------------------
    # Incremental pipeline
    # ------------------------------------------------------------------

    def run_incremental_pipeline(
        self,
        doc_ids: List[str],
        use_llm: bool = True,
        max_chunks: Optional[int] = None,
        skip_built: bool = False,
        force_rebuild: bool = False,
    ) -> Dict[str, Any]:
        """
        Run incremental pipeline: build specified documents -> incremental fusion.

        Steps:
        1. Snapshot existing entity IDs
        2. Build graph for each specified document
        3. Identify newly created entity IDs
        4. Run incremental fusion (new entities vs existing graph)

        Args:
            doc_ids: List of document IDs to process
            use_llm: Whether to use LLM for extraction
            max_chunks: Max chunks per document

        Returns:
            Combined result dict with build and fusion summaries.
        """
        if not doc_ids:
            return {"mode": "incremental_pipeline", "status": "skipped", "reason": "no doc_ids provided"}

        logger.info(f"========== KG Incremental Pipeline: START ({len(doc_ids)} docs) ==========")

        # Step 1: Snapshot current entity IDs
        ids_before = self._snapshot_entity_ids()
        logger.info(f"[Pipeline] Snapshot: {len(ids_before)} existing entities")

        # Step 2: Build graph for each document
        logger.info(f"[Pipeline Step 1/2] Building graph for {len(doc_ids)} documents...")
        build_results = []
        success_count = 0
        failed_count = 0

        for doc_id in doc_ids:
            try:
                result = self.builder.build_from_document(
                    doc_id=doc_id,
                    use_llm=use_llm,
                    max_chunks=max_chunks,
                    skip_if_built=skip_built,
                    force_rebuild=force_rebuild,
                )
                build_results.append(result)
                if result.get("status") == "success":
                    success_count += 1
                else:
                    failed_count += 1
            except Exception as e:
                logger.error(f"Failed to build graph for {doc_id}: {e}")
                build_results.append({"doc_id": doc_id, "status": "failed", "error": str(e)})
                failed_count += 1

        logger.info(
            f"[Pipeline Step 1/2] Build complete: {success_count}/{len(doc_ids)} succeeded"
        )

        # Step 3: Identify new entity IDs
        new_entity_ids = self._get_recent_entity_ids(ids_before)
        logger.info(f"[Pipeline] {len(new_entity_ids)} new entities created")

        # Step 4: Incremental fusion
        logger.info("[Pipeline Step 2/2] Running incremental fusion...")
        if new_entity_ids:
            fusion_result = self.fusion.fuse_incremental(new_entity_ids)
        else:
            fusion_result = {"mode": "incremental", "status": "skipped", "reason": "no new entities"}

        logger.info("[Pipeline Step 2/2] Incremental fusion complete")

        summary = {
            "mode": "incremental_pipeline",
            "build": {
                "total": len(doc_ids),
                "success": success_count,
                "failed": failed_count,
                "documents": build_results,
            },
            "new_entities_count": len(new_entity_ids),
            "fusion": fusion_result,
            "status": "success",
        }

        logger.info("========== KG Incremental Pipeline: DONE ==========")
        return summary


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_orchestrator(
    mongodb_client: MongoDBClient,
    neo4j_client: Neo4jClient,
) -> KGOrchestrator:
    """Create orchestrator from database clients and environment variables."""
    graph_store = create_graph_store_service(neo4j_client)
    fusion_service = create_fusion_service(neo4j_client)
    return KGOrchestrator(mongodb_client, neo4j_client, graph_store, fusion_service)
