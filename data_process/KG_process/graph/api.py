"""
Graph API endpoints for knowledge graph construction and querying.
"""

import asyncio
from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List, Optional
import logging
import threading
from datetime import datetime, timezone

from ..schemas.graph_schemas import (
    GraphBuildRequest,
    GraphBuildResponse,
    BatchGraphBuildRequest,
    BatchGraphBuildResponse,
    BatchGraphBuildStateResponse,
    GraphQueryRequest,
    GraphQueryResponse,
    PlotInfoResponse,
    GraphStatistics,
    SubgraphData,
    FusionRequest,
    FusionResponse,
    PipelineRequest,
    PipelineResponse,
)
from .builder import GraphBuilder
from ..graph_store import create_graph_store_service
from ..fusion import create_fusion_service
from ..orchestrator import create_orchestrator
from ...core.database.manager import db_manager
from ...core import config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/graph", tags=["graph"])
_db_init_lock = threading.Lock()
_db_init_inflight = False
_batch_build_lock = threading.Lock()
_batch_build_inflight = False
_batch_build_last_result: Optional[Dict[str, Any]] = None
_batch_build_last_error: Optional[str] = None
_batch_build_started_at: Optional[str] = None
_batch_build_finished_at: Optional[str] = None


def _kickoff_db_init() -> None:
    """Kick off DB initialization in background once, so graph endpoints fail fast."""
    global _db_init_inflight
    with _db_init_lock:
        if db_manager._initialized or _db_init_inflight:
            return
        _db_init_inflight = True

    def _runner() -> None:
        global _db_init_inflight
        try:
            db_manager.ensure_initialized(
                max_retries=config.DB_INIT_MAX_RETRIES,
                retry_delay_seconds=config.DB_INIT_RETRY_DELAY_SECONDS,
            )
        except Exception as exc:
            logger.warning("Background DB init failed: %s", exc)
        finally:
            with _db_init_lock:
                _db_init_inflight = False

    threading.Thread(target=_runner, daemon=True).start()


def _ensure_db_ready() -> None:
    if db_manager._initialized:
        return
    _kickoff_db_init()
    raise HTTPException(status_code=503, detail="Database is initializing, please retry shortly.")


def _create_graph_builder() -> GraphBuilder:
    """Create graph builder with all dependencies."""
    _ensure_db_ready()

    graph_store = create_graph_store_service(db_manager.neo4j)

    return GraphBuilder(
        mongodb_client=db_manager.mongodb,
        graph_store=graph_store
    )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _estimate_batch_total_documents(max_docs: Optional[int]) -> int:
    """Best-effort estimate used for async kickoff response."""
    try:
        total = int(db_manager.mongodb.count_documents("documents"))
    except Exception as exc:
        logger.warning("Failed to estimate document count for async graph build: %s", exc)
        return 0
    if max_docs is not None and max_docs > 0:
        return min(total, max_docs)
    return total


def _snapshot_batch_build_state() -> Dict[str, Any]:
    with _batch_build_lock:
        return {
            "in_flight": _batch_build_inflight,
            "result": dict(_batch_build_last_result or {}) if _batch_build_last_result else None,
            "error": _batch_build_last_error,
            "started_at": _batch_build_started_at,
            "finished_at": _batch_build_finished_at,
        }


def _run_async_batch_build(request: Any) -> None:
    """Run batch build in a daemon thread and update module-level state."""
    global _batch_build_inflight
    global _batch_build_last_result
    global _batch_build_last_error
    global _batch_build_finished_at

    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None

    try:
        builder = _create_graph_builder()
        result = builder.build_from_all_documents(
            use_llm=request.use_llm,
            max_docs=request.max_docs,
            skip_built=request.skip_built,
            force_rebuild=request.force_rebuild,
        )
    except Exception as exc:
        error_message = str(exc)
        logger.error("Async batch graph build failed: %s", exc)
    finally:
        with _batch_build_lock:
            _batch_build_inflight = False
            _batch_build_last_result = result
            _batch_build_last_error = error_message
            _batch_build_finished_at = _utc_now_iso()


def _start_async_batch_build(request: Any) -> bool:
    """Start async batch build if no active job exists."""
    global _batch_build_inflight
    global _batch_build_last_result
    global _batch_build_last_error
    global _batch_build_started_at
    global _batch_build_finished_at

    with _batch_build_lock:
        if _batch_build_inflight:
            return False
        _batch_build_inflight = True
        _batch_build_last_result = None
        _batch_build_last_error = None
        _batch_build_started_at = _utc_now_iso()
        _batch_build_finished_at = None

    request_copy = request.model_copy(deep=True) if hasattr(request, "model_copy") else request
    threading.Thread(target=_run_async_batch_build, args=(request_copy,), daemon=True).start()
    return True


def _make_batch_state_response() -> BatchGraphBuildStateResponse:
    state = _snapshot_batch_build_state()
    in_flight = bool(state["in_flight"])
    error = state["error"]
    result_raw = state["result"]

    status = "running" if in_flight else "idle"
    if not in_flight and error:
        status = "failed"
    elif not in_flight and result_raw:
        status = "completed"

    result_model = BatchGraphBuildResponse(**result_raw) if result_raw else None
    return BatchGraphBuildStateResponse(
        status=status,
        in_flight=in_flight,
        started_at=state["started_at"],
        finished_at=state["finished_at"],
        error=error,
        result=result_model,
    )


@router.post("/build", response_model=GraphBuildResponse)
async def build_graph(request: GraphBuildRequest) -> GraphBuildResponse:
    """
    Build knowledge graph from a single document.

    This endpoint:
    1. Retrieves document chunks from MongoDB
    2. Extracts entities and relationships (using LLM or regex)
    3. Creates nodes and relationships in Neo4j

    Entity types: 片区, 地块, 空间要素, 法规, 标准, 导则
    Relationship types: PART_OF, CONTAINS, ADJACENT_TO, LOCATED_IN, APPLIES_TO, REFERENCES, DERIVED_FROM, HAS_PROPERTY
    """
    try:
        builder = _create_graph_builder()
        result = builder.build_from_document(
            doc_id=request.doc_id,
            use_llm=request.use_llm,
            max_chunks=request.max_chunks,
            skip_if_built=request.skip_if_built,
            force_rebuild=request.force_rebuild,
        )

        if result.get("status") == "failed":
            raise HTTPException(
                status_code=404,
                detail=result.get("error", "Failed to build graph")
            )

        return GraphBuildResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to build graph: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/build/batch", response_model=BatchGraphBuildResponse)
async def build_graph_batch(request: BatchGraphBuildRequest) -> BatchGraphBuildResponse:
    """
    Build knowledge graph from all documents in MongoDB.

    This endpoint processes all ingested documents and constructs
    a comprehensive knowledge graph.
    """
    try:
        if request.async_mode:
            _ensure_db_ready()
            started = _start_async_batch_build(request)
            if started:
                logger.info("Accepted async batch graph build request")
            else:
                logger.info("Async batch graph build already running; returning current kickoff snapshot")

            snapshot = _snapshot_batch_build_state()
            if snapshot["result"] and not snapshot["in_flight"]:
                return BatchGraphBuildResponse(**snapshot["result"])

            return BatchGraphBuildResponse(
                total=_estimate_batch_total_documents(request.max_docs),
                success=0,
                failed=0,
                documents=[],
            )

        builder = _create_graph_builder()
        result = await asyncio.to_thread(
            builder.build_from_all_documents,
            use_llm=request.use_llm,
            max_docs=request.max_docs,
            skip_built=request.skip_built,
            force_rebuild=request.force_rebuild,
        )
        return BatchGraphBuildResponse(**result)

    except Exception as e:
        logger.error(f"Failed to build batch graph: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/build/batch/state", response_model=BatchGraphBuildStateResponse)
async def get_batch_build_state() -> BatchGraphBuildStateResponse:
    """Return state of async batch graph build job."""
    try:
        return _make_batch_state_response()
    except Exception as e:
        logger.error(f"Failed to get batch graph build state: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/query", response_model=GraphQueryResponse)
async def query_graph(request: GraphQueryRequest) -> GraphQueryResponse:
    """
    Execute a Cypher query on the knowledge graph.

    Example queries:
    - Find all plots: MATCH (p:地块) RETURN p
    - Find plot properties: MATCH (p:地块 {name: "DU01-01"}) RETURN p.name, p.far, p.height_limit
    - Find plots in district: MATCH (p:地块)-[:PART_OF]->(d:片区) RETURN p.name, d.name
    """
    try:
        builder = _create_graph_builder()
        results = builder.graph_store.query_graph(
            cypher=request.cypher,
            parameters=request.parameters
        )

        return GraphQueryResponse(
            results=results,
            count=len(results)
        )

    except Exception as e:
        logger.error(f"Failed to query graph: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/plot/{plot_name}", response_model=PlotInfoResponse)
async def get_plot_info(plot_name: str) -> PlotInfoResponse:
    """
    Get comprehensive information about a specific plot.

    Returns:
    - Plot properties (far, height_limit, setback, etc.)
    - Districts the plot belongs to
    - Related regulations/standards/guidelines
    """
    try:
        builder = _create_graph_builder()
        info = builder.graph_store.get_plot_info(plot_name)

        if not info:
            raise HTTPException(
                status_code=404,
                detail=f"Plot {plot_name} not found"
            )

        return PlotInfoResponse(
            plot_name=plot_name,
            properties=info.get("properties", {}),
            districts=info.get("districts", []),
            locations=info.get("locations", []),
            rules=info.get("rules", []),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get plot info: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/entities/{entity_type}")
async def get_entities_by_type(entity_type: str, limit: int = 100) -> Dict[str, Any]:
    """
    Get all entities of a specific type.

    Entity types: 片区, 地块, 空间要素, 法规, 标准, 导则
    """
    from ..graph_store import VALID_ENTITY_TYPES

    if entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid entity type: {entity_type}. Must be one of: {', '.join(sorted(VALID_ENTITY_TYPES))}"
        )

    try:
        builder = _create_graph_builder()

        cypher = f"""
        MATCH (n:{entity_type})
        RETURN n
        LIMIT $limit
        """

        results = builder.graph_store.query_graph(
            cypher,
            {"limit": limit}
        )

        return {
            "entity_type": entity_type,
            "count": len(results),
            "entities": results
        }

    except Exception as e:
        logger.error(f"Failed to get entities: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/statistics", response_model=GraphStatistics)
async def get_graph_statistics() -> GraphStatistics:
    """
    Get knowledge graph statistics.

    Returns:
    - Total number of nodes
    - Total number of relationships
    - Entity types and counts
    """
    try:
        builder = _create_graph_builder()
        stats = builder.get_graph_statistics()
        return GraphStatistics(**stats)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get graph statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/documents/status")
async def get_document_build_statuses() -> Dict[str, Any]:
    """Return per-document graph build status from Neo4j :Document nodes."""
    try:
        _ensure_db_ready()
        docs = db_manager.neo4j.list_document_statuses()
        return {"documents": docs}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get document build statuses: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/visualize", response_model=SubgraphData)
async def visualize_graph(
    limit: int = 200,
    include_documents: bool = True,
    max_relationships: int = 5000,
) -> SubgraphData:
    """
    Return a limited "full graph" view for visualization.

    - Selects top-*limit* nodes by degree
    - Returns relationships where both endpoints are in the selected node set
    - Optionally includes :Document nodes (default: True)

    Note: This endpoint is designed for UI preview and should not be treated
    as a full export API.
    """
    try:
        _ensure_db_ready()
        data = db_manager.neo4j.get_visual_subgraph(
            limit=limit,
            include_documents=include_documents,
            max_relationships=max_relationships,
        )
        return SubgraphData(**data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to visualize graph: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/clear")
async def clear_graph() -> Dict[str, str]:
    """
    Clear all nodes and relationships from the graph.

    WARNING: This operation cannot be undone!
    """
    try:
        _ensure_db_ready()

        db_manager.neo4j.delete_all()

        return {
            "status": "success",
            "message": "Graph cleared successfully"
        }

    except Exception as e:
        logger.error(f"Failed to clear graph: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test")
async def test_graph_build() -> Dict[str, Any]:
    """
    Test graph building with the first available document.

    This endpoint finds the first document in MongoDB and builds
    a graph from it for testing purposes.
    """
    try:
        builder = _create_graph_builder()

        # Find first document
        documents = db_manager.mongodb.find_by_query(
            "documents",
            {},
            limit=1,
            projection={"_id": 1, "file_name": 1}
        )

        if not documents:
            raise HTTPException(
                status_code=404,
                detail="No documents found in MongoDB"
            )

        doc = documents[0]
        doc_id = doc["_id"]
        file_name = doc.get("file_name", "")

        # Build graph
        result = builder.build_from_document(doc_id, use_llm=True)

        return {
            "message": "Test graph build successful",
            "file_name": file_name,
            "result": result
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Test graph build failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Fusion endpoints
# ---------------------------------------------------------------------------

@router.post("/fuse", response_model=FusionResponse)
async def fuse_graph(request: FusionRequest) -> FusionResponse:
    """
    Run knowledge graph fusion.

    Modes:
    - full: Disambiguate all entities + discover cross-document relations.
      Use after first-time graph construction.
    - incremental: Only fuse specified new entities against existing graph.
      Use after adding new documents.
    """
    try:
        _ensure_db_ready()

        fusion = create_fusion_service(db_manager.neo4j)
        fusion.confidence_threshold = request.confidence_threshold

        if request.mode == "incremental":
            if not request.new_entity_ids:
                raise HTTPException(
                    status_code=400,
                    detail="new_entity_ids is required for incremental mode",
                )
            result = fusion.fuse_incremental(request.new_entity_ids)
        else:
            result = fusion.fuse_full()

        return FusionResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Graph fusion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Pipeline endpoints
# ---------------------------------------------------------------------------

@router.post("/pipeline", response_model=PipelineResponse)
async def run_pipeline(request: PipelineRequest) -> PipelineResponse:
    """
    Run the full build + fuse pipeline.

    Modes:
    - full: Build graph from all documents, then run full fusion.
      Use for first-time setup.
    - incremental: Build graph for specified documents, then fuse new entities
      against existing graph. Use when adding new materials.
    """
    try:
        _ensure_db_ready()

        orchestrator = create_orchestrator(db_manager.mongodb, db_manager.neo4j)

        if request.mode == "incremental":
            if not request.doc_ids:
                raise HTTPException(
                    status_code=400,
                    detail="doc_ids is required for incremental mode",
                )
            result = orchestrator.run_incremental_pipeline(
                doc_ids=request.doc_ids,
                use_llm=request.use_llm,
                max_chunks=request.max_chunks,
                skip_built=request.skip_built,
                force_rebuild=request.force_rebuild,
            )
        else:
            result = orchestrator.run_full_pipeline(
                use_llm=request.use_llm,
                max_docs=request.max_docs,
                skip_built=request.skip_built,
                force_rebuild=request.force_rebuild,
            )

        return PipelineResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Pipeline failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
