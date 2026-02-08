"""
Schemas for graph API endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class GraphEntity(BaseModel):
    """Graph entity model."""

    type: str = Field(..., description="Entity type (Plot, Indicator, Function, etc.)")
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
    """Response with plot information."""

    plot_name: str = Field(..., description="Plot name")
    indicators: List[Dict[str, Any]] = Field(default_factory=list, description="Plot indicators")
    functions: List[str] = Field(default_factory=list, description="Plot functions")
    requirements: List[str] = Field(default_factory=list, description="Plot requirements")
    locations: List[str] = Field(default_factory=list, description="Plot locations")


class GraphStatistics(BaseModel):
    """Graph statistics."""

    total_nodes: int = Field(..., description="Total number of nodes")
    total_relationships: int = Field(..., description="Total number of relationships")
    entity_types: List[str] = Field(..., description="List of entity types")
    entity_counts: Dict[str, int] = Field(..., description="Count by entity type")
