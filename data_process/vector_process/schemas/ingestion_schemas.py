"""
Schemas for ingestion API endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class IngestionRequest(BaseModel):
    """Request to ingest a single document."""

    markdown_path: str = Field(..., description="Path to markdown file")
    meta_path: str = Field(..., description="Path to metadata JSON file")
    images_dir: Optional[str] = Field(None, description="Path to images directory")
    process_images: bool = Field(True, description="Whether to process images")


class IngestionResponse(BaseModel):
    """Response from document ingestion."""

    doc_id: str = Field(..., description="Generated document ID")
    file_name: str = Field(..., description="Original file name")
    chunks_count: int = Field(..., description="Number of chunks in latest version")
    images_processed: int = Field(..., description="Number of images processed")
    status: str = Field(..., description="Ingestion status")
    operation: Optional[str] = Field(None, description="created/updated/reprocessed/skip/rollback")
    version: Optional[int] = Field(None, description="Document version after operation")
    embeddings_generated: Optional[int] = Field(None, description="Number of embeddings generated this run")
    unchanged_chunks: Optional[int] = Field(None, description="Number of unchanged chunks")
    removed_chunks: Optional[int] = Field(None, description="Number of removed chunks")


class BatchIngestionRequest(BaseModel):
    """Request to ingest multiple documents."""

    ocr_output_dir: str = Field(..., description="Path to OCR output directory")
    category: Optional[str] = Field(None, description="Optional category filter")
    process_images: bool = Field(True, description="Whether to process images")


class BatchIngestionResponse(BaseModel):
    """Response from batch ingestion."""

    total: int = Field(..., description="Total documents found")
    success: int = Field(..., description="Successfully ingested")
    failed: int = Field(..., description="Failed to ingest")
    skipped: int = Field(0, description="Skipped (already ingested)")
    added: int = Field(0, description="Newly added documents")
    updated: int = Field(0, description="Updated/reprocessed documents")
    documents: List[Dict[str, Any]] = Field(..., description="List of ingestion results")


class IngestionStatus(BaseModel):
    """Status of ingestion system."""

    milvus_vectors: int = Field(..., description="Number of vectors in Milvus")
    mongodb_documents: int = Field(..., description="Number of documents in MongoDB")
    mongodb_chunks: int = Field(..., description="Number of chunks in MongoDB")


class IngestionReportRequest(BaseModel):
    """Request to report ingestion status for documents in a directory."""

    ocr_output_dir: str = Field(..., description="Path to OCR output directory")
    category: Optional[str] = Field(None, description="Optional category filter")


class DocumentIngestionState(BaseModel):
    """Ingestion state for a single document."""

    file_name: str = Field(..., description="Document file name")
    markdown_path: str = Field(..., description="Markdown file path")
    status: str = Field(..., description="not_started/in_progress/complete/failed")
    doc_id: Optional[str] = Field(None, description="Document ID in MongoDB")
    chunks_count: int = Field(0, description="Number of chunks created")
    images_processed: int = Field(0, description="Number of images processed")
    version: Optional[int] = Field(None, description="Current version number")
    ingested_at: Optional[str] = Field(None, description="Last ingestion time")
    ingest_error: Optional[str] = Field(None, description="Last ingestion error")


class IngestionReportResponse(BaseModel):
    """Response containing ingestion status for documents."""

    total: int = Field(..., description="Total documents found")
    not_started: int = Field(..., description="Documents not started")
    in_progress: int = Field(..., description="Documents in progress")
    complete: int = Field(..., description="Documents completed")
    failed: int = Field(..., description="Documents failed")
    documents: List[DocumentIngestionState] = Field(..., description="Document states")


class RollbackRequest(BaseModel):
    """Request to rollback one document to a previous version."""

    doc_id: str = Field(..., description="Document ID")
    target_version: int = Field(..., gt=0, description="Target historical version")
    process_images: bool = Field(False, description="Whether to process images when rolling back")
    images_dir: Optional[str] = Field(None, description="Optional images directory")


class DeleteDocumentRequest(BaseModel):
    """Request to delete one document from all stores."""

    doc_id: str = Field(..., description="Document ID")
    delete_versions: bool = Field(False, description="Whether to delete version history snapshots")


class DocumentVersionsResponse(BaseModel):
    """Document version history response."""

    doc_id: str = Field(..., description="Document ID")
    current_version: int = Field(0, description="Current version")
    current_content_hash: str = Field("", description="Current content hash")
    current_status: str = Field("", description="Current ingestion status")
    history: List[Dict[str, Any]] = Field(default_factory=list, description="Historical version snapshots")


class ConsistencyRepairRequest(BaseModel):
    """Request to run consistency check/repair across stores."""

    dry_run: bool = Field(True, description="Only report inconsistency without modifying data")
    cleanup_inconsistent_docs: bool = Field(False, description="Cleanup inconsistent docs during repair")
    doc_ids: Optional[List[str]] = Field(None, description="Optional subset of doc IDs")


class ConsistencyRepairResponse(BaseModel):
    """Response for consistency check/repair."""

    dry_run: bool = Field(..., description="Whether this run is dry-run")
    target_docs: int = Field(0, description="Number of target docs")
    mongo_documents: int = Field(0, description="MongoDB document count in scope")
    mongo_chunks: int = Field(0, description="MongoDB chunk count in scope")
    milvus_vectors_scanned: int = Field(0, description="Milvus vectors scanned")
    graph_documents: int = Field(0, description="Neo4j document nodes counted")
    orphan_chunks: int = Field(0, description="Orphan Mongo chunk count")
    orphan_vectors: int = Field(0, description="Orphan Milvus vector count")
    orphan_graph_documents: int = Field(0, description="Orphan Neo4j document count")
    inconsistent_docs: List[Dict[str, Any]] = Field(default_factory=list, description="Docs with chunk/vector mismatch")
    repaired: Dict[str, int] = Field(default_factory=dict, description="Repair action counters")
