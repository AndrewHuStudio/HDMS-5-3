from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field

from core.database.manager import db_manager
from core import config
from rag.retriever import MultiSourceRetriever
from rag.service import create_rag_service
from rag.embedder import create_embedding_service
from rag.graph_query import GraphQueryService

router = APIRouter()
logger = logging.getLogger(__name__)


class ChatMessage(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    role: str
    content: str


class ChatRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    question: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list)


class SourceInfo(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    type: str
    name: str
    section: Optional[str] = None
    source: str
    chunk_id: Optional[str] = None


class ChatResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    answer: str
    model: str
    sources: List[SourceInfo] = Field(default_factory=list)


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
    """
    RAG-based question answering (non-streaming).

    Retrieves context from Milvus/Neo4j/MongoDB, builds prompt, calls LLM.
    """
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
            use_retrieval=True,
            top_k=5
        )

        sources = [
            SourceInfo(**src) for src in result.get("sources", [])
        ]

        return ChatResponse(
            answer=result["answer"],
            model=result["model"],
            sources=sources,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"QA chat failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/qa/chat/stream")
def chat_stream(request: ChatRequest):
    """
    RAG-based question answering with SSE streaming.

    Returns Server-Sent Events:
    - sources: source metadata (sent first)
    - thinking: reasoning process tokens (DeepSeek-R1)
    - answer: answer tokens
    - done: completion signal
    - error: error information
    """
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
                    use_retrieval=True,
                    top_k=5,
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


@router.get("/rag/sources/{chunk_id}")
def get_source_details(chunk_id: str):
    """
    Get detailed information about a specific source chunk.

    Args:
        chunk_id: Chunk ID from search results

    Returns:
        Detailed chunk information including full text and metadata
    """
    try:
        if not db_manager._initialized:
            raise HTTPException(
                status_code=503,
                detail="Database connections not initialized"
            )

        # Retrieve chunk from MongoDB
        chunk = db_manager.mongodb.find_by_id("chunks", chunk_id)

        if not chunk:
            raise HTTPException(
                status_code=404,
                detail=f"Chunk {chunk_id} not found"
            )

        # Get document info
        doc_id = chunk.get("doc_id")
        document = db_manager.mongodb.find_by_id("documents", doc_id)

        return {
            "chunk_id": chunk_id,
            "text": chunk.get("text", ""),
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
