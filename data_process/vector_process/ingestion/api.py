"""
Ingestion API endpoints for document processing.
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any, Optional
from pathlib import Path
import hashlib
import re
import logging

from ..schemas.ingestion_schemas import (
    IngestionRequest,
    IngestionResponse,
    BatchIngestionRequest,
    BatchIngestionResponse,
    IngestionStatus,
    IngestionReportRequest,
    IngestionReportResponse,
    DocumentIngestionState
)
from .chunker import DocumentChunker
from .embedder import create_embedding_service
from ..vision_service import create_vision_service
from .pipeline import IngestionPipeline
from ...core.database.manager import db_manager
from ...core import config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


def _select_best_doc(candidates: list[dict[str, Any]], markdown_name: str) -> Optional[Dict[str, Any]]:
    """Pick the most likely document record when multiple records share one content hash."""
    if not candidates:
        return None

    same_name = [doc for doc in candidates if doc.get("file_name") == markdown_name]
    pool = same_name or candidates
    status_priority = {"complete": 3, "in_progress": 2, "failed": 1, "not_started": 0}
    pool.sort(
        key=lambda doc: (
            status_priority.get(doc.get("ingest_status") or "not_started", -1),
            str(doc.get("ingested_at") or ""),
            str(doc.get("_id") or "")
        ),
        reverse=True
    )
    return pool[0]



def _create_pipeline() -> IngestionPipeline:
    """Create ingestion pipeline with all dependencies."""
    if not db_manager._initialized:
        raise HTTPException(
            status_code=503,
            detail="Database connections not initialized"
        )

    chunker = DocumentChunker(chunk_size=800, overlap=100)
    embedder = create_embedding_service()
    vision = create_vision_service()

    return IngestionPipeline(
        milvus_client=db_manager.milvus,
        mongodb_client=db_manager.mongodb,
        embedding_service=embedder,
        vision_service=vision,
        chunker=chunker
    )


@router.post("/document", response_model=IngestionResponse)
async def ingest_document(request: IngestionRequest) -> IngestionResponse:
    """
    Ingest a single OCR document.

    Process flow:
    1. Load markdown + metadata
    2. Chunk document
    3. Generate embeddings
    4. Process images (optional)
    5. Store in Milvus + MongoDB
    """
    try:
        pipeline = _create_pipeline()
        result = pipeline.ingest_document(
            markdown_path=request.markdown_path,
            meta_path=request.meta_path,
            images_dir=request.images_dir,
            process_images=request.process_images
        )
        return IngestionResponse(**result)
    except Exception as e:
        logger.error(f"Failed to ingest document: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch", response_model=BatchIngestionResponse)
async def ingest_batch(request: BatchIngestionRequest) -> BatchIngestionResponse:
    """
    Ingest all documents from OCR output directory.

    This endpoint processes all documents in the specified directory,
    optionally filtering by category.
    """
    try:
        pipeline = _create_pipeline()
        result = pipeline.ingest_batch(
            ocr_output_dir=request.ocr_output_dir,
            category=request.category,
            process_images=request.process_images
        )
        return BatchIngestionResponse(**result)
    except Exception as e:
        logger.error(f"Failed to ingest batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status", response_model=IngestionStatus)
async def get_status() -> IngestionStatus:
    """
    Get ingestion system status.

    Returns counts of vectors and documents in the databases.
    """
    try:
        if not db_manager._initialized:
            raise HTTPException(
                status_code=503,
                detail="Database connections not initialized"
            )

        # Get Milvus stats
        milvus_stats = db_manager.milvus.get_collection_stats(
            config.MILVUS_COLLECTION_TEXT
        )
        milvus_count = milvus_stats.get("num_entities", 0) if milvus_stats.get("exists") else 0

        # Get MongoDB stats
        doc_count = db_manager.mongodb.count_documents("documents")
        chunk_count = db_manager.mongodb.count_documents("chunks")

        return IngestionStatus(
            milvus_vectors=milvus_count,
            mongodb_documents=doc_count,
            mongodb_chunks=chunk_count
        )
    except Exception as e:
        logger.error(f"Failed to get status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/report", response_model=IngestionReportResponse)
async def report_ingestion(request: IngestionReportRequest) -> IngestionReportResponse:
    """
    Report ingestion status for documents in an OCR output directory.
    """
    if not db_manager._initialized:
        raise HTTPException(
            status_code=503,
            detail="Database connections not initialized"
        )

    output_path = Path(request.ocr_output_dir)
    if not output_path.exists() or not output_path.is_dir():
        raise HTTPException(
            status_code=404,
            detail=f"OCR output directory not found: {output_path}"
        )

    # Build document directory list
    if request.category:
        cat_dir = output_path / request.category
        if not cat_dir.exists() or not cat_dir.is_dir():
            raise HTTPException(
                status_code=404,
                detail=f"Category directory not found: {cat_dir}"
            )
        doc_dirs = [p for p in cat_dir.iterdir() if p.is_dir()]
    else:
        doc_dirs = []
        for cat_dir in output_path.iterdir():
            if cat_dir.is_dir():
                doc_dirs.extend([p for p in cat_dir.iterdir() if p.is_dir()])

    # Load existing documents from MongoDB
    existing_docs = db_manager.mongodb.find_by_query(
        "documents",
        {},
        limit=None,
        projection={
            "_id": 1,
            "file_name": 1,
            "markdown_path": 1,
            "content_hash": 1,
            "ingest_status": 1,
            "chunks_count": 1,
            "images_processed": 1,
            "ingested_at": 1,
            "ingest_error": 1
        }
    )
    docs_by_path: dict[str, dict[str, Any]] = {}
    for doc in existing_docs:
        markdown_path = doc.get("markdown_path")
        if not markdown_path:
            continue
        docs_by_path[markdown_path] = doc
        try:
            docs_by_path[str(Path(markdown_path).resolve())] = doc
        except Exception:
            pass
    docs_by_hash: dict[str, list[dict[str, Any]]] = {}
    for doc in existing_docs:
        content_hash = doc.get("content_hash")
        if not content_hash:
            continue
        docs_by_hash.setdefault(content_hash, []).append(doc)

    documents: list[DocumentIngestionState] = []
    counts = {"not_started": 0, "in_progress": 0, "complete": 0, "failed": 0}

    for doc_dir in doc_dirs:
        md_files = [p for p in doc_dir.glob("*.md") if not p.name.endswith(".meta.md")]
        meta_files = list(doc_dir.glob("*.meta.json"))

        if not md_files:
            documents.append(DocumentIngestionState(
                file_name=doc_dir.name,
                markdown_path=str(doc_dir),
                status="failed",
                ingest_error="missing markdown file"
            ))
            counts["failed"] += 1
            continue
        if not meta_files:
            documents.append(DocumentIngestionState(
                file_name=md_files[0].name,
                markdown_path=str(md_files[0].resolve()),
                status="failed",
                ingest_error="missing metadata file"
            ))
            counts["failed"] += 1
            continue

        markdown_path = str(md_files[0].resolve())
        doc = docs_by_path.get(markdown_path)

        if not doc:
            content_hash = ""
            try:
                content_hash = hashlib.sha256(md_files[0].read_text(encoding="utf-8").encode("utf-8")).hexdigest()
            except Exception:
                content_hash = ""

            if content_hash:
                doc = _select_best_doc(docs_by_hash.get(content_hash, []), md_files[0].name)
        if not doc:
            documents.append(DocumentIngestionState(
                file_name=md_files[0].name,
                markdown_path=markdown_path,
                status="not_started"
            ))
            counts["not_started"] += 1
            continue

        status = doc.get("ingest_status") or "not_started"
        if status not in {"not_started", "in_progress", "complete", "failed"}:
            status = "failed"
        counts[status] = counts.get(status, 0) + 1

        documents.append(DocumentIngestionState(
            file_name=doc.get("file_name") or md_files[0].name,
            markdown_path=markdown_path,
            status=status,
            doc_id=str(doc.get("_id")),
            chunks_count=int(doc.get("chunks_count") or 0),
            images_processed=int(doc.get("images_processed") or 0),
            ingested_at=doc.get("ingested_at"),
            ingest_error=doc.get("ingest_error") or None
        ))

    total = len(documents)
    return IngestionReportResponse(
        total=total,
        not_started=counts["not_started"],
        in_progress=counts["in_progress"],
        complete=counts["complete"],
        failed=counts["failed"],
        documents=documents
    )

@router.post("/test")
async def test_ingestion() -> Dict[str, Any]:
    """
    Test ingestion with a sample document from OCR output.

    This endpoint finds the first available document and ingests it
    for testing purposes.
    """
    try:
        import os
        from pathlib import Path

        # Find first document in OCR output
        ocr_dir = Path(config.PROJECT_ROOT) / "data" / "ocr_output"

        if not ocr_dir.exists():
            raise HTTPException(
                status_code=404,
                detail=f"OCR output directory not found: {ocr_dir}"
            )

        # Find first category and document
        for cat_dir in ocr_dir.iterdir():
            if not cat_dir.is_dir():
                continue

            for doc_dir in cat_dir.iterdir():
                if not doc_dir.is_dir():
                    continue

                # Find markdown and meta files
                md_files = list(doc_dir.glob("*.md"))
                meta_files = list(doc_dir.glob("*.meta.json"))

                if md_files and meta_files:
                    pipeline = _create_pipeline()
                    result = pipeline.ingest_document(
                        markdown_path=str(md_files[0]),
                        meta_path=str(meta_files[0]),
                        images_dir=str(doc_dir / "images") if (doc_dir / "images").exists() else None,
                        process_images=True
                    )
                    return {
                        "message": "Test ingestion successful",
                        "result": result
                    }

        raise HTTPException(
            status_code=404,
            detail="No documents found in OCR output directory"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Test ingestion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
