"""
Schemas for RAG API endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class RAGChatMessage(BaseModel):
    """Chat message model."""

    role: str = Field(..., description="Message role (user or assistant)")
    content: str = Field(..., description="Message content")


class RAGChatRequest(BaseModel):
    """Request for RAG chat."""

    question: str = Field(..., min_length=1, max_length=2000, description="User question")
    history: List[RAGChatMessage] = Field(default_factory=list, description="Conversation history")
    use_retrieval: bool = Field(True, description="Whether to use retrieval")
    top_k: int = Field(5, ge=1, le=20, description="Number of retrieval results")


class SourceInfo(BaseModel):
    """Source information."""

    type: str = Field(..., description="Source type (document, plot, etc.)")
    name: str = Field(..., description="Source name")
    section: Optional[str] = Field(None, description="Document section")
    source: str = Field(..., description="Retrieval source (vector_search, knowledge_graph)")
    chunk_id: Optional[str] = Field(None, description="Chunk ID for fetching preview text")


class RAGChatResponse(BaseModel):
    """Response from RAG chat."""

    answer: str = Field(..., description="Generated answer")
    sources: List[SourceInfo] = Field(default_factory=list, description="Source documents and entities")
    context_used: bool = Field(..., description="Whether context was used")
    model: str = Field(..., description="Model used for generation")


class RetrievalStats(BaseModel):
    """Statistics about the retrieval process."""

    vector_count: int = Field(0, description="Number of vector search results")
    graph_count: int = Field(0, description="Number of graph search results")
    keyword_count: int = Field(0, description="Number of keyword search results")
    fused_count: int = Field(0, description="Number of fused results after dedup")
    reranked: bool = Field(False, description="Whether reranking was applied")
    cached: bool = Field(False, description="Whether result was from cache")
    weights: Dict[str, float] = Field(default_factory=dict, description="Fusion weights used")


class FeedbackRequest(BaseModel):
    """Request to submit answer quality feedback."""

    message_id: str = Field(..., min_length=1, description="Frontend message ID")
    question: str = Field(..., min_length=1, description="The original question")
    answer: str = Field(..., description="The answer that was rated")
    rating: str = Field(..., description="'useful' or 'not_useful'")
    comment: Optional[str] = Field(None, max_length=500, description="Optional user comment")


class FeedbackResponse(BaseModel):
    """Response after submitting feedback."""

    success: bool
    feedback_id: str


class RAGSearchRequest(BaseModel):
    """Request for RAG search (retrieval only)."""

    query: str = Field(..., min_length=1, max_length=500, description="Search query")
    top_k: int = Field(5, ge=1, le=20, description="Number of results")
    use_vector: bool = Field(True, description="Use vector search")
    use_graph: bool = Field(True, description="Use graph search")
    use_keyword: bool = Field(True, description="Use keyword search")


class RAGSearchResponse(BaseModel):
    """Response from RAG search."""

    vector_results: List[Dict[str, Any]] = Field(default_factory=list, description="Vector search results")
    graph_results: List[Dict[str, Any]] = Field(default_factory=list, description="Graph search results")
    keyword_results: List[Dict[str, Any]] = Field(default_factory=list, description="Keyword search results")
    fused_results: List[Dict[str, Any]] = Field(default_factory=list, description="Fused results")
    total_count: int = Field(..., description="Total number of results")
