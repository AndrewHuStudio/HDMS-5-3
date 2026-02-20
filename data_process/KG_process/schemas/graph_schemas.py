"""
Schemas for graph API endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class GraphEntity(BaseModel):
    """Graph entity model."""

    type: str = Field(..., description="Entity type (片区, 地块, 空间要素, 法规, 标准, 导则)")
    name: str = Field(..., description="Entity name")
    properties: Dict[str, Any] = Field(default_factory=dict, description="Entity properties")


class GraphRelationship(BaseModel):
    """Graph relationship model."""

    from_name: str = Field(..., description="Source entity name", alias="from")
    from_type: str = Field(..., description="Source entity type")
    to: str = Field(..., description="Target entity name")
    to_type: str = Field(..., description="Target entity type")
    type: str = Field(..., description="Relationship type")
    properties: Dict[str, Any] = Field(default_factory=dict, description="Relationship properties")

    class Config:
        populate_by_name = True


class GraphBuildRequest(BaseModel):
    """Request to build graph from document."""

    doc_id: str = Field(..., description="Document ID")
    use_llm: bool = Field(True, description="Whether to use LLM for entity extraction")
    max_chunks: Optional[int] = Field(None, description="Maximum chunks to process")
    skip_if_built: bool = Field(False, description="Skip if doc is already marked as built")
    force_rebuild: bool = Field(False, description="Force rebuild even if already built")


class GraphBuildResponse(BaseModel):
    """Response from graph building."""

    doc_id: str = Field(..., description="Document ID")
    entities_count: int = Field(..., description="Number of entities created")
    relationships_count: int = Field(..., description="Number of relationships created")
    status: str = Field(..., description="Build status")


class BatchGraphBuildRequest(BaseModel):
    """Request to build graph from all documents."""

    use_llm: bool = Field(True, description="Whether to use LLM for entity extraction")
    max_docs: Optional[int] = Field(None, description="Maximum documents to process")
    skip_built: bool = Field(False, description="Skip documents already marked as built")
    force_rebuild: bool = Field(False, description="Force rebuild even if already built")


class BatchGraphBuildResponse(BaseModel):
    """Response from batch graph building."""

    total: int = Field(..., description="Total documents processed")
    success: int = Field(..., description="Successfully processed")
    failed: int = Field(..., description="Failed to process")
    documents: List[Dict[str, Any]] = Field(..., description="List of build results")


class GraphQueryRequest(BaseModel):
    """Request to query graph with Cypher."""

    cypher: str = Field(..., description="Cypher query string")
    parameters: Optional[Dict[str, Any]] = Field(None, description="Query parameters")


class GraphQueryResponse(BaseModel):
    """Response from graph query."""

    results: List[Dict[str, Any]] = Field(..., description="Query results")
    count: int = Field(..., description="Number of results")


class PlotInfoResponse(BaseModel):
    """Response with plot information (new schema: indicators as node properties)."""

    plot_name: str = Field(..., description="Plot name")
    properties: Dict[str, Any] = Field(default_factory=dict, description="Plot properties (far, height_limit, setback, etc.)")
    districts: List[str] = Field(default_factory=list, description="Districts the plot belongs to")
    locations: List[str] = Field(default_factory=list, description="Locations of the plot")
    rules: List[Dict[str, Any]] = Field(default_factory=list, description="Related regulations/standards/guidelines")


class GraphStatistics(BaseModel):
    """Graph statistics."""

    total_nodes: int = Field(..., description="Total number of nodes")
    total_relationships: int = Field(..., description="Total number of relationships")
    entity_types: List[str] = Field(..., description="List of entity types")
    entity_counts: Dict[str, int] = Field(..., description="Count by entity type")
    doc_count: int = Field(0, description="Number of distinct source documents in graph")


# ---------------------------------------------------------------------------
# Visualization schemas
# ---------------------------------------------------------------------------


class GraphNodeViz(BaseModel):
    """A node used for frontend visualization."""

    id: str = Field(..., description="Neo4j element ID")
    label: str = Field(..., description="Primary node label (e.g., 地块, 片区, Document)")
    name: str = Field(..., description="Display name")
    properties: Dict[str, Any] = Field(default_factory=dict, description="Node properties")


class GraphEdgeViz(BaseModel):
    """A relationship used for frontend visualization."""

    id: str = Field(..., description="Neo4j element ID")
    type: str = Field(..., description="Relationship type (e.g., PART_OF, DERIVED_FROM)")
    source: str = Field(..., description="Source node element ID")
    target: str = Field(..., description="Target node element ID")
    properties: Dict[str, Any] = Field(default_factory=dict, description="Relationship properties")


class SubgraphData(BaseModel):
    """Subgraph data for visualization."""

    nodes: List[GraphNodeViz] = Field(default_factory=list, description="Graph nodes")
    edges: List[GraphEdgeViz] = Field(default_factory=list, description="Graph edges")


# ---------------------------------------------------------------------------
# Fusion schemas
# ---------------------------------------------------------------------------

class FusionRequest(BaseModel):
    """Request to run graph fusion."""

    mode: str = Field(
        "full",
        description="Fusion mode: 'full' for all entities, 'incremental' for new entities only",
    )
    new_entity_ids: Optional[List[str]] = Field(
        None,
        description="Entity IDs to fuse (required for incremental mode)",
    )
    confidence_threshold: float = Field(
        0.8,
        description="Minimum confidence to merge entities (0.0-1.0)",
    )


class FusionMergeDetail(BaseModel):
    """Detail of a single entity merge."""

    kept: str = Field(..., description="Name of the entity that was kept")
    removed: str = Field(..., description="Name of the entity that was removed")
    confidence: float = Field(..., description="LLM confidence score")
    reason: str = Field("", description="LLM reasoning")


class FusionDisambiguationResult(BaseModel):
    """Disambiguation result for one entity type."""

    entity_type: str = Field(..., description="Entity type label")
    candidates: int = Field(..., description="Number of candidate pairs evaluated")
    merged: int = Field(..., description="Number of entities merged")
    merges: List[FusionMergeDetail] = Field(default_factory=list, description="Merge details")


class FusionResponse(BaseModel):
    """Response from graph fusion."""

    mode: str = Field(..., description="Fusion mode used")
    disambiguation: Dict[str, Any] = Field(..., description="Disambiguation summary")
    cross_doc_relations: Dict[str, Any] = Field(..., description="Cross-doc relation discovery summary")
    status: str = Field(..., description="Fusion status")


# ---------------------------------------------------------------------------
# Pipeline schemas
# ---------------------------------------------------------------------------

class PipelineRequest(BaseModel):
    """Request to run the full build+fuse pipeline."""

    mode: str = Field(
        "full",
        description="Pipeline mode: 'full' for all documents, 'incremental' for specific documents",
    )
    doc_ids: Optional[List[str]] = Field(
        None,
        description="Document IDs to process (required for incremental mode)",
    )
    use_llm: bool = Field(True, description="Whether to use LLM for extraction")
    max_docs: Optional[int] = Field(None, description="Max documents for full mode")
    max_chunks: Optional[int] = Field(None, description="Max chunks per document for incremental mode")
    skip_built: bool = Field(False, description="Skip documents already marked as built")
    force_rebuild: bool = Field(False, description="Force rebuild even if already built")


class PipelineResponse(BaseModel):
    """Response from the build+fuse pipeline."""

    mode: str = Field(..., description="Pipeline mode used")
    build: Dict[str, Any] = Field(..., description="Build phase summary")
    fusion: Dict[str, Any] = Field(..., description="Fusion phase summary")
    status: str = Field(..., description="Pipeline status")
