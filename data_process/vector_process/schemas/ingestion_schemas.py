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
    chunks_count: int = Field(..., description="Number of chunks created")
    images_processed: int = Field(..., description="Number of images processed")
    status: str = Field(..., description="Ingestion status")


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
