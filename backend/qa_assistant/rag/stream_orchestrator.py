"""Event orchestration for a retrieval-grounded QA stream."""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Dict, Generator, List, Optional, Tuple, TYPE_CHECKING

from core import config as app_config
from rag import prompting as rag_prompting
from rag import retrieval_mode as rag_retrieval_mode
from rag.postprocess import summary as pp_summary

if TYPE_CHECKING:
    from rag.service import RAGService

logger = logging.getLogger(__name__)
StreamEvent = Tuple[str, Dict[str, Any]]


def answer_question_stream(
    service: "RAGService",
    question: str,
    history: Optional[List[Dict[str, str]]] = None,
    use_retrieval: bool = True,
    top_k: int = app_config.QA_DEFAULT_TOP_K,
    should_emit_answer_replacement: Callable[[str, str], Tuple[bool, Optional[str]]] | None = None,
) -> Generator[StreamEvent, None, None]:
    """Yield QA events, placing the retrieval overview after visible thinking."""
    question = (question or "").strip()
    stream_start = time.perf_counter()
    logger.info("[TIMING] Stream started for question: %s...", question[:50])

    quick_reply = service._get_quick_reply(question)
    if quick_reply is not None:
        yield ("sources", {"sources": []})
        yield ("answer", {"content": quick_reply})
        yield ("done", {"model": service.llm_model, "context_used": False})
        return

    selection = rag_retrieval_mode.resolve_retrieval_selection(
        use_retrieval=bool(use_retrieval),
        raw_mode=(getattr(app_config, "STREAM_RETRIEVAL_MODE", "") or getattr(app_config, "QA_RETRIEVAL_MODE", "hybrid")).strip().lower(),
        allowed_modes=getattr(app_config, "QA_RETRIEVAL_MODES", getattr(app_config, "STREAM_RETRIEVAL_MODES", set())),
        default_mode="hybrid",
        allow_keyword=False,
    )
    stream_top_k = max(1, min(service._normalize_top_k(top_k), int(app_config.STREAM_RETRIEVAL_TOP_K_CAP)))
    context = ""
    sources: List[Dict[str, Any]] = []
    overview = ""

    try:
        if selection.enabled:
            yield ("status", {"stage": "understanding", "message": "正在理解你的问题..."})
            yield ("status", {"stage": "retrieving", "message": "正在检索相关资料..."})
            retrieval_start = time.perf_counter()
            try:
                results = service.retriever.retrieve(
                    query=question, top_k=stream_top_k, use_vector=selection.use_vector,
                    use_graph=selection.use_graph, use_keyword=selection.use_keyword,
                    enable_rerank=app_config.STREAM_ENABLE_RERANK,
                )
            except Exception as exc:
                logger.error("Retrieval failed: %s", exc)
                yield ("error", {"detail": f"Retrieval failed: {exc}"})
                return
            logger.info("[TIMING] Retrieval completed in %.2fms", (time.perf_counter() - retrieval_start) * 1000)
            context, sources = service._build_context_and_sources(results or {}, query=question)
            yield ("sources", {"sources": sources})
            stats_source = results or {}
            doc_names = [str(item.get("name") or "").strip() for item in pp_summary.collect_document_summary_items(sources) if str(item.get("name") or "").strip()]
            candidate_count = sum(len(stats_source.get(key, [])) for key in ("vector_results", "graph_results", "keyword_results"))
            fused_count = len(stats_source.get("fused_results", []))
            yield ("retrieval_stats", {
                "vector_count": len(stats_source.get("vector_results", [])), "graph_count": len(stats_source.get("graph_results", [])),
                "keyword_count": len(stats_source.get("keyword_results", [])), "fused_count": fused_count,
                "reranked": bool(stats_source.get("reranked", False)), "cached": False,
                "weights": service.retriever._compute_weights(question), "timed_out": bool(stats_source.get("timed_out", False)),
                "timed_out_branches": stats_source.get("timed_out_branches", []), "mode": selection.mode, "top_k": stream_top_k,
                "document_count": len(doc_names), "document_names": doc_names,
            })
            for graph_result in stats_source.get("graph_results", []):
                data = graph_result.get("data") if graph_result.get("type") == "subgraph" else None
                if data and data.get("nodes"):
                    yield ("graph", {"nodes": data["nodes"], "edges": data.get("edges", [])})
                    break
            overview = service._build_retrieval_overview_text(
                candidate_count=candidate_count, fused_count=fused_count, doc_names=doc_names, sources=sources,
            )
            doc_nums = sorted({source["doc_num"] for source in sources if source.get("doc_num")})
            prompt = service._build_prompt(question, context, history, retrieval_hint=None, source_doc_nums=doc_nums,
                                           source_doc_required_labels=rag_prompting.build_doc_required_labels(sources))
        else:
            yield ("sources", {"sources": []})
            yield ("status", {"stage": "understanding", "message": "正在理解你的问题..."})
            prompt = service._build_prompt(question, context, history, retrieval_hint=None)

        yield ("status", {"stage": "reasoning", "message": "正在进行智能研判..."})
        full_answer_parts: List[str] = []
        overview_emitted = False
        thinking_seen = False
        first_answer_received = False
        llm_start = time.perf_counter()
        for event_type, payload in service._stream_chat_completion(prompt, max_tokens=app_config.QA_STREAM_MAX_TOKENS):
            if event_type == "thinking":
                thinking_seen = True
            if event_type == "thinking_done" and overview and not overview_emitted:
                yield ("thinking_done", payload)
                yield ("answer", {"content": overview})
                full_answer_parts.append(overview)
                overview_emitted = True
                continue
            if event_type == "answer" and overview and not overview_emitted:
                # Some providers do not expose reasoning tokens; preserve a useful answer order.
                if thinking_seen:
                    yield ("thinking_done", {})
                yield ("answer", {"content": overview})
                full_answer_parts.append(overview)
                overview_emitted = True
            if event_type == "answer":
                piece = payload.get("content", "")
                full_answer_parts.append(piece)
                if piece and not first_answer_received:
                    first_answer_received = True
                    logger.info(
                        "[TIMING] First answer token after %.2fms (total %.2fms)",
                        (time.perf_counter() - llm_start) * 1000,
                        (time.perf_counter() - stream_start) * 1000,
                    )
            yield (event_type, payload)
    except Exception as exc:
        logger.error("LLM streaming failed: %s", exc)
        yield ("error", {"detail": str(exc)})
        return

    full_answer = "".join(full_answer_parts)
    if full_answer:
        streamed_sources = sources
        finalized_answer, finalized_sources = service._finalize_answer_and_sources(
            full_answer, sources, question=question,
            missing_image_log="Streamed answer mentions figures but no image-bearing sources survived filtering.",
        )
        if finalized_answer != full_answer:
            can_replace, reject_reason = (should_emit_answer_replacement or (lambda _current, _replacement: (True, None)))(
                full_answer, finalized_answer,
            )
            if can_replace:
                yield ("answer_replaced", {"content": finalized_answer, "sources": finalized_sources})
                sources = finalized_sources
            else:
                logger.warning("Skip answer_replaced due to degraded markdown shape: %s", reject_reason)
                sources = streamed_sources
        else:
            sources = finalized_sources
    yield ("done", {"model": service.llm_model, "context_used": bool(context)})
