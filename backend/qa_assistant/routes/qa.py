from __future__ import annotations

import json
import re
import time
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import List

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
    try:
        retriever = _create_retriever()
        rag_service = create_rag_service(retriever)

        history = [
            {"role": h.role, "content": h.content}
            for h in request.history[-8:]
        ]

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

        return {
            "chunk_id": chunk_id,
            "text": text,
            "summary": summary,
            "matched_keywords": matched_keywords,
            "section_title": chunk.get("section_title", ""),
            "has_table": chunk.get("has_table", False),
            "has_image": chunk.get("has_image", False),
            "document": {
                "file_name": document.get("file_name", "") if document else "",
                "category": document.get("category", "") if document else "",
                "pages": document.get("pages", 0) if document else 0
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get source details: {e}")
        raise HTTPException(status_code=500, detail=str(e))
