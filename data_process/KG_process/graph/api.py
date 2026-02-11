"""
Graph API endpoints for knowledge graph construction and querying.
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List
import logging

from ..schemas.graph_schemas import (
    GraphBuildRequest,
    GraphBuildResponse,
    BatchGraphBuildRequest,
    BatchGraphBuildResponse,
    GraphQueryRequest,
    GraphQueryResponse,
    PlotInfoResponse,
    GraphStatistics
)
from .builder import GraphBuilder
from ..graph_store import create_graph_store_service
from ...core.database.manager import db_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/graph", tags=["graph"])


def _create_graph_builder() -> GraphBuilder:
    """Create graph builder with all dependencies."""
    if not db_manager._initialized:
        raise HTTPException(
            status_code=503,
            detail="Database connections not initialized"
        )

    graph_store = create_graph_store_service(db_manager.neo4j)

    return GraphBuilder(
        mongodb_client=db_manager.mongodb,
        graph_store=graph_store
    )


@router.post("/build", response_model=GraphBuildResponse)
async def build_graph(request: GraphBuildRequest) -> GraphBuildResponse:
    """
    Build knowledge graph from a single document.

    This endpoint:
    1. Retrieves document chunks from MongoDB
    2. Extracts entities and relationships (using LLM or regex)
    3. Creates nodes and relationships in Neo4j

    Entity types: Plot, Indicator, Function, Requirement, Location
    Relationship types: HAS_INDICATOR, HAS_FUNCTION, HAS_REQUIREMENT, LOCATED_IN
    """
    try:
        builder = _create_graph_builder()
        result = builder.build_from_document(
            doc_id=request.doc_id,
            use_llm=request.use_llm,
            max_chunks=request.max_chunks
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
        builder = _create_graph_builder()
        result = builder.build_from_all_documents(
            use_llm=request.use_llm,
            max_docs=request.max_docs
        )
        return BatchGraphBuildResponse(**result)

    except Exception as e:
        logger.error(f"Failed to build batch graph: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/query", response_model=GraphQueryResponse)
async def query_graph(request: GraphQueryRequest) -> GraphQueryResponse:
    """
    Execute a Cypher query on the knowledge graph.

    Example queries:
    - Find all plots: MATCH (p:Plot) RETURN p
    - Find plot indicators: MATCH (p:Plot {name: "DU01-01"})-[r:HAS_INDICATOR]->(i:Indicator) RETURN i.name, r.value
    - Find related plots: MATCH (p1:Plot)-[:RELATES_TO]-(p2:Plot) RETURN p1.name, p2.name
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
    - Plot indicators with values
    - Plot functions
    - Plot requirements
    - Plot locations
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
            indicators=info.get("indicators", []),
            functions=info.get("functions", []),
            requirements=info.get("requirements", []),
            locations=info.get("locations", [])
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

    Entity types: Plot, Indicator, Function, Requirement, Location, Document
    """
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

    except Exception as e:
        logger.error(f"Failed to get graph statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/clear")
async def clear_graph() -> Dict[str, str]:
    """
    Clear all nodes and relationships from the graph.

    WARNING: This operation cannot be undone!
    """
    try:
        if not db_manager._initialized:
            raise HTTPException(
                status_code=503,
                detail="Database connections not initialized"
            )

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
