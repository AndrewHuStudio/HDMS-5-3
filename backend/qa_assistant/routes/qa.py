from __future__ import annotations

import json
import re
import time
import logging
import mimetypes
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from typing import List, Optional

from core.database.manager import db_manager
from core import config
from rag.retriever import MultiSourceRetriever
from rag.service import create_rag_service
from rag.embedder import create_embedding_service
from rag.graph_query import GraphQueryService
from rag.cache import get_query_cache
from schemas.rag_schemas import (
    RAGChatRequest as ChatRequest,
    RAGChatResponse as ChatResponse,
    SourceInfo,
    FeedbackRequest,
    FeedbackResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _resolve_pdf_path(document: Optional[dict]) -> Optional[Path]:
    """Resolve a local PDF path for a document record if possible."""
    if not document:
        return None

    metadata = document.get("metadata") or {}
    candidates: List[str] = []

    for key in ("pdf_path", "source_pdf_path"):
        value = document.get(key) or metadata.get(key)
        if isinstance(value, str) and value.strip():
            candidates.append(value.strip())

    markdown_path = document.get("markdown_path")
    file_name = document.get("file_name")
    if isinstance(markdown_path, str) and markdown_path.strip():
        md_path = Path(markdown_path)
        candidates.append(str(md_path.with_suffix(".pdf")))
        if isinstance(file_name, str) and file_name.lower().endswith(".pdf"):
            candidates.append(str(md_path.parent / file_name))

    if isinstance(file_name, str) and file_name.lower().endswith(".pdf"):
        candidates.append(file_name)

    checked = set()
    for raw in candidates:
        if raw in checked:
            continue
        checked.add(raw)

        if raw.lower().startswith("http://") or raw.lower().startswith("https://"):
            continue

        try:
            candidate = Path(raw).expanduser()
        except Exception:
            continue

        if candidate.exists() and candidate.is_file():
            return candidate

    return None


def _find_matching_bracket(text: str, start: int, opener: str, closer: str) -> int:
    if start >= len(text) or text[start] != opener:
        return -1

    depth = 1
    i = start + 1
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _extract_parenthesized(text: str, start: int):
    if start >= len(text) or text[start] != "(":
        return None, start

    depth = 1
    i = start + 1
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1:i], i + 1
        i += 1
    return None, start + 1


def _strip_image_ref(ref: str) -> str:
    cleaned = ref.strip()
    if not cleaned:
        return ""

    if cleaned.startswith("<"):
        end = cleaned.find(">")
        cleaned = cleaned[1:end] if end != -1 else cleaned[1:]
    else:
        title_match = re.match(r'^(.*?)(?:\s+["\'][^"\']*["\'])\s*$', cleaned)
        if title_match:
            cleaned = title_match.group(1)

    cleaned = cleaned.strip().strip("\"'")
    cleaned = cleaned.replace("\\ ", " ").replace("\\\\", "\\")
    cleaned = cleaned.split("#", 1)[0]
    cleaned = cleaned.split("?", 1)[0]
    return cleaned.strip()


def _extract_image_refs(markdown_text: str) -> List[str]:
    """Extract unique markdown image references from text."""
    refs: List[str] = []
    seen = set()

    idx = 0
    markdown = markdown_text or ""
    marker = "!["
    length = len(markdown)
    while idx < length:
        marker_idx = markdown.find(marker, idx)
        if marker_idx == -1:
            break

        alt_end = _find_matching_bracket(markdown, marker_idx + 1, "[", "]")
        if alt_end == -1:
            idx = marker_idx + len(marker)
            continue

        pos = alt_end + 1
        while pos < length and markdown[pos].isspace():
            pos += 1

        if pos >= length or markdown[pos] != "(":
            idx = marker_idx + len(marker)
            continue

        raw_ref, next_idx = _extract_parenthesized(markdown, pos)
        if raw_ref is None:
            idx = marker_idx + len(marker)
            continue

        ref = _strip_image_ref(raw_ref)
        if ref and not ref.lower().startswith(("http://", "https://", "data:")) and ref not in seen:
            seen.add(ref)
            refs.append(ref)

        idx = next_idx

    return refs


def _resolve_image_path(document: Optional[dict], image_ref: str) -> Optional[Path]:
    """Resolve an image reference to a local file path for this document."""
    if not document or not image_ref:
        return None

    metadata = document.get("metadata") or {}
    markdown_path = document.get("markdown_path")
    images_dir = document.get("images_dir") or metadata.get("images_dir")
    normalized_ref = _strip_image_ref(image_ref).replace("\\", "/")
    if not normalized_ref:
        return None

    ref_path = Path(normalized_ref)

    candidates: List[Path] = []
    if ref_path.is_absolute():
        candidates.append(ref_path)

    if isinstance(markdown_path, str) and markdown_path.strip():
        doc_dir = Path(markdown_path).expanduser().parent
        candidates.append(doc_dir / normalized_ref)
        candidates.append(doc_dir / "images" / ref_path.name)

    if isinstance(images_dir, str) and images_dir.strip():
        img_dir_path = Path(images_dir).expanduser()
        candidates.append(img_dir_path / normalized_ref)
        candidates.append(img_dir_path / ref_path.name)

    checked = set()
    for candidate in candidates:
        key = str(candidate)
        if key in checked:
            continue
        checked.add(key)
        if candidate.exists() and candidate.is_file():
            return candidate

    return None

def _create_retriever() -> MultiSourceRetriever:
    """Create multi-source retriever with all dependencies."""
    if not db_manager._initialized:
        raise HTTPException(
            status_code=503,
            detail="Database connections not initialized"
        )

    embedder = create_embedding_service()
    graph_query = GraphQueryService(db_manager.neo4j)

    return MultiSourceRetriever(
        milvus_client=db_manager.milvus,
        mongodb_client=db_manager.mongodb,
        graph_store=graph_query,
        embedder=embedder,
        collection_name=config.MILVUS_COLLECTION_TEXT
    )


@router.post("/qa/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    """RAG-based question answering (non-streaming)."""
    try:
        retriever = _create_retriever()
        rag_service = create_rag_service(retriever)

        history = [
            {"role": h.role, "content": h.content}
            for h in request.history[-8:]
        ]

        result = rag_service.answer_question(
            question=request.question.strip(),
            history=history,
            use_retrieval=request.use_retrieval,
            top_k=request.top_k,
        )

        sources = [
            SourceInfo(**src) for src in result.get("sources", [])
        ]

        return ChatResponse(
            answer=result["answer"],
            model=result["model"],
            sources=sources,
            context_used=result.get("context_used", True),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"QA chat failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/qa/chat/stream")
def chat_stream(request: ChatRequest):
    """RAG-based question answering with SSE streaming."""
    import time
    request_start = time.perf_counter()
    logger.info(f"[TIMING] Request received at /qa/chat/stream")

    try:
        retriever = _create_retriever()
        rag_service = create_rag_service(retriever)

        history = [
            {"role": h.role, "content": h.content}
            for h in request.history[-8:]
        ]

        setup_elapsed = (time.perf_counter() - request_start) * 1000
        logger.info(f"[TIMING] Request setup completed in {setup_elapsed:.2f}ms")

        def event_generator():
            try:
                for event_type, data in rag_service.answer_question_stream(
                    question=request.question.strip(),
                    history=history,
                    use_retrieval=request.use_retrieval,
                    top_k=request.top_k,
                ):
                    yield f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
            except Exception as e:
                logger.error(f"QA stream error: {e}")
                error_data = json.dumps({"detail": str(e)}, ensure_ascii=False)
                yield f"event: error\ndata: {error_data}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"QA stream setup failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/qa/feedback", response_model=FeedbackResponse)
def submit_feedback(request: FeedbackRequest):
    """Submit feedback on answer quality. Stores in MongoDB qa_feedback collection."""
    try:
        if not db_manager._initialized:
            raise HTTPException(status_code=503, detail="Database not initialized")

        feedback_id = f"fb-{int(time.time())}-{request.message_id[:8]}"

        feedback_doc = {
            "_id": feedback_id,
            "message_id": request.message_id,
            "question": request.question,
            "answer": request.answer[:2000],
            "rating": request.rating,
            "comment": request.comment,
            "created_at": time.time(),
        }

        db_manager.mongodb.insert_document("qa_feedback", feedback_doc)
        logger.info("Feedback stored: %s -> %s", feedback_id, request.rating)

        return FeedbackResponse(success=True, feedback_id=feedback_id)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to store feedback: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/qa/cache/stats")
def cache_stats():
    """Get query cache statistics."""
    return get_query_cache().get_stats()


@router.post("/qa/cache/clear")
def clear_cache():
    """Clear query cache so latest retrieval/source fields take effect immediately."""
    cache = get_query_cache()
    cache.invalidate_all()
    return {"success": True}


@router.get("/rag/sources/{chunk_id}")
def get_source_details(chunk_id: str, q: str = Query("", description="Original query for keyword highlighting")):
    """Get detailed information about a specific source chunk."""
    try:
        if not db_manager._initialized:
            raise HTTPException(
                status_code=503,
                detail="Database connections not initialized"
            )

        chunk = db_manager.mongodb.find_by_id("chunks", chunk_id)

        if not chunk:
            raise HTTPException(
                status_code=404,
                detail=f"Chunk {chunk_id} not found"
            )

        doc_id = chunk.get("doc_id")
        document = db_manager.mongodb.find_by_id("documents", doc_id)

        text = chunk.get("text", "")
        summary = text[:200] + ("..." if len(text) > 200 else "")

        # Extract keywords from query that appear in the text
        matched_keywords = []
        if q:
            tokens = [t for t in re.split(r'\s+', q.strip()) if len(t) >= 2]
            for token in tokens:
                if token in text:
                    matched_keywords.append(token)

        document_meta = document.get("metadata", {}) if document else {}
        raw_page = (
            chunk.get("page")
            or chunk.get("page_number")
            or chunk.get("page_num")
            or document_meta.get("page")
            or document_meta.get("page_number")
        )
        page_hint = None
        if isinstance(raw_page, int):
            page_hint = raw_page
        elif isinstance(raw_page, str) and raw_page.isdigit():
            page_hint = int(raw_page)

        raw_page_end = chunk.get("page_end") or document_meta.get("page_end")
        page_end_hint = None
        if isinstance(raw_page_end, int):
            page_end_hint = raw_page_end
        elif isinstance(raw_page_end, str) and raw_page_end.isdigit():
            page_end_hint = int(raw_page_end)

        pdf_path = _resolve_pdf_path(document)
        pdf_url = f"/rag/documents/{doc_id}/pdf" if doc_id and pdf_path else None

        image_refs = _extract_image_refs(text)
        preview_images = []
        for ref in image_refs[:3]:
            if not doc_id:
                continue
            if not _resolve_image_path(document, ref):
                continue
            preview_images.append({
                "name": Path(ref).name,
                "ref": ref,
                "url": f"/rag/documents/{doc_id}/image?ref={quote(ref)}",
            })

        return {
            "chunk_id": chunk_id,
            "doc_id": doc_id,
            "chunk_index": chunk.get("chunk_index"),
            "page_hint": page_hint,
            "page_end_hint": page_end_hint,
            "text": text,
            "summary": summary,
            "matched_keywords": matched_keywords,
            "section_title": chunk.get("section_title", ""),
            "has_table": chunk.get("has_table", False),
            "has_image": chunk.get("has_image", False),
            "images": preview_images,
            "document": {
                "doc_id": doc_id,
                "file_name": document.get("file_name", "") if document else "",
                "category": document.get("category", "") if document else "",
                "pages": document.get("pages", 0) if document else 0,
                "pdf_url": pdf_url,
                "markdown_path": document.get("markdown_path") if document else None,
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get source details: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rag/documents/{doc_id}/pdf")
def open_document_pdf(doc_id: str):
    """Open original PDF for a document if present on disk."""
    try:
        if not db_manager._initialized:
            raise HTTPException(status_code=503, detail="Database connections not initialized")

        document = db_manager.mongodb.find_by_id("documents", doc_id)
        if not document:
            raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")

        pdf_path = _resolve_pdf_path(document)
        if not pdf_path:
            raise HTTPException(status_code=404, detail="PDF file not found for this document")

        return FileResponse(path=pdf_path, media_type="application/pdf", filename=pdf_path.name)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to open document pdf: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rag/documents/{doc_id}/image")
def open_document_image(doc_id: str, ref: str = Query(..., description="Image reference from markdown chunk")):
    """Open a source image extracted from the original document markdown."""
    try:
        if not db_manager._initialized:
            raise HTTPException(status_code=503, detail="Database connections not initialized")

        document = db_manager.mongodb.find_by_id("documents", doc_id)
        if not document:
            raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")

        image_path = _resolve_image_path(document, ref)
        if not image_path:
            raise HTTPException(status_code=404, detail="Image file not found for this reference")

        media_type = mimetypes.guess_type(str(image_path))[0] or "application/octet-stream"
        return FileResponse(path=image_path, media_type=media_type, filename=image_path.name)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to open document image: {e}")
        raise HTTPException(status_code=500, detail=str(e))
