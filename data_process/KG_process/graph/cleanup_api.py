"""
Graph cleanup API endpoints.
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any
import logging

from ..entity_filter import create_graph_cleaner
from ...core.database.manager import db_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/graph/cleanup", tags=["graph-cleanup"])


def _ensure_db_ready() -> None:
    if db_manager._initialized:
        return
    try:
        db_manager.ensure_initialized()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database connections not initialized: {exc}") from exc


@router.post("/isolated")
async def cleanup_isolated_nodes(min_degree: int = 1) -> Dict[str, Any]:
    """
    Remove nodes with degree less than min_degree.

    Args:
        min_degree: Minimum number of relationships (default 1 = remove isolated nodes)

    Returns:
        Number of nodes removed and updated statistics
    """
    try:
        _ensure_db_ready()

        cleaner = create_graph_cleaner(db_manager.neo4j)
        removed = cleaner.remove_isolated_nodes(min_degree=min_degree)

        # Get updated statistics
        stats = db_manager.neo4j.get_statistics()

        return {
            "status": "success",
            "removed_count": removed,
            "min_degree": min_degree,
            "updated_stats": {
                "total_nodes": stats.get("node_count", 0),
                "total_relationships": stats.get("relationship_count", 0),
            }
        }

    except Exception as e:
        logger.error(f"Failed to cleanup isolated nodes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/rare")
async def cleanup_rare_nodes(min_frequency: int = 2) -> Dict[str, Any]:
    """
    Remove nodes that appear in fewer than min_frequency documents.

    Args:
        min_frequency: Minimum number of documents (default 2)

    Returns:
        Number of nodes removed and updated statistics
    """
    try:
        _ensure_db_ready()

        cleaner = create_graph_cleaner(db_manager.neo4j)
        removed = cleaner.remove_nodes_by_frequency(min_frequency=min_frequency)

        stats = db_manager.neo4j.get_statistics()

        return {
            "status": "success",
            "removed_count": removed,
            "min_frequency": min_frequency,
            "updated_stats": {
                "total_nodes": stats.get("node_count", 0),
                "total_relationships": stats.get("relationship_count", 0),
            }
        }

    except Exception as e:
        logger.error(f"Failed to cleanup rare nodes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/merge-similar")
async def merge_similar_entities(similarity_threshold: float = 0.9) -> Dict[str, Any]:
    """
    Merge entities with very similar names (likely duplicates with typos).

    Args:
        similarity_threshold: Minimum similarity score (0.0-1.0, default 0.9)

    Returns:
        Number of entities merged and updated statistics
    """
    try:
        _ensure_db_ready()

        if not 0.0 <= similarity_threshold <= 1.0:
            raise HTTPException(
                status_code=400,
                detail="similarity_threshold must be between 0.0 and 1.0"
            )

        cleaner = create_graph_cleaner(db_manager.neo4j)
        merged = cleaner.merge_similar_names(similarity_threshold=similarity_threshold)

        stats = db_manager.neo4j.get_statistics()

        return {
            "status": "success",
            "merged_count": merged,
            "similarity_threshold": similarity_threshold,
            "updated_stats": {
                "total_nodes": stats.get("node_count", 0),
                "total_relationships": stats.get("relationship_count", 0),
            }
        }

    except Exception as e:
        logger.error(f"Failed to merge similar entities: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/full")
async def full_cleanup(
    remove_isolated: bool = True,
    min_degree: int = 1,
    min_frequency: int = 2,
    merge_similar: bool = True,
    similarity_threshold: float = 0.9,
) -> Dict[str, Any]:
    """
    Run full cleanup pipeline: remove isolated nodes, rare nodes, and merge similar entities.

    Args:
        remove_isolated: Whether to remove isolated/low-degree nodes
        min_degree: Minimum degree for nodes to keep
        min_frequency: Minimum document frequency for nodes to keep
        merge_similar: Whether to merge similar entities
        similarity_threshold: Similarity threshold for merging

    Returns:
        Summary of all cleanup operations
    """
    try:
        _ensure_db_ready()

        cleaner = create_graph_cleaner(db_manager.neo4j)
        results = {}

        # Step 1: Remove isolated/low-degree nodes
        if remove_isolated:
            removed = cleaner.remove_isolated_nodes(min_degree=min_degree)
            results["removed_isolated"] = removed
            logger.info(f"Removed {removed} isolated/low-degree nodes")

        # Step 2: Remove rare nodes
        if min_frequency > 0:
            removed = cleaner.remove_nodes_by_frequency(min_frequency=min_frequency)
            results["removed_rare"] = removed
            logger.info(f"Removed {removed} rare nodes")

        # Step 3: Merge similar entities
        if merge_similar:
            merged = cleaner.merge_similar_names(similarity_threshold=similarity_threshold)
            results["merged_similar"] = merged
            logger.info(f"Merged {merged} similar entities")

        # Get final statistics
        stats = db_manager.neo4j.get_statistics()

        return {
            "status": "success",
            "operations": results,
            "total_removed": results.get("removed_isolated", 0) + results.get("removed_rare", 0),
            "total_merged": results.get("merged_similar", 0),
            "updated_stats": {
                "total_nodes": stats.get("node_count", 0),
                "total_relationships": stats.get("relationship_count", 0),
            }
        }

    except Exception as e:
        logger.error(f"Failed to run full cleanup: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/statistics")
async def get_cleanup_statistics() -> Dict[str, Any]:
    """
    Get statistics about potential cleanup targets.

    Returns:
        Statistics about isolated nodes, rare nodes, and potential duplicates
    """
    try:
        _ensure_db_ready()

        # Count isolated nodes
        isolated_result = db_manager.neo4j.query(
            """
            MATCH (n) WHERE NOT n:Document AND size((n)--()) = 0
            RETURN count(n) as count
            """
        )
        isolated_count = isolated_result[0]["count"] if isolated_result else 0

        # Count low-degree nodes (degree < 2)
        low_degree_result = db_manager.neo4j.query(
            """
            MATCH (n) WHERE NOT n:Document
            WITH n, size((n)--()) as degree
            WHERE degree < 2
            RETURN count(n) as count
            """
        )
        low_degree_count = low_degree_result[0]["count"] if low_degree_result else 0

        # Count rare nodes (appearing in only 1 document)
        rare_result = db_manager.neo4j.query(
            """
            MATCH (n) WHERE NOT n:Document AND n.source_doc IS NOT NULL
            WITH n, count(DISTINCT n.source_doc) as doc_count
            WHERE doc_count = 1
            RETURN count(n) as count
            """
        )
        rare_count = rare_result[0]["count"] if rare_result else 0

        # Get overall statistics
        stats = db_manager.neo4j.get_statistics()
        total_nodes = stats.get("node_count", 0)

        return {
            "total_nodes": total_nodes,
            "total_relationships": stats.get("relationship_count", 0),
            "isolated_nodes": isolated_count,
            "low_degree_nodes": low_degree_count,
            "rare_nodes": rare_count,
            "isolated_percentage": round(isolated_count / total_nodes * 100, 2) if total_nodes > 0 else 0,
            "low_degree_percentage": round(low_degree_count / total_nodes * 100, 2) if total_nodes > 0 else 0,
            "rare_percentage": round(rare_count / total_nodes * 100, 2) if total_nodes > 0 else 0,
        }

    except Exception as e:
        logger.error(f"Failed to get cleanup statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))
