"""
RAG service for intelligent question answering.
"""

import json
import re
import urllib.request
from typing import List, Dict, Any, Optional, Generator, Tuple
import logging
from pathlib import Path
import threading

import openai

from core import config as app_config
from rag.retriever import MultiSourceRetriever
from rag.cache import get_query_cache
from rag import prompting as rag_prompting
from rag import retrieval_helpers as rag_retrieval
from rag import context_builder as rag_context_builder
from rag import retrieval_mode as rag_retrieval_mode

from rag.postprocess import citations as pp_citations
from rag.postprocess import answer as pp_answer
from rag.postprocess import sources as pp_sources
from rag.postprocess import markdown as pp_markdown
from rag.postprocess import images as pp_images
from rag.postprocess import summary as pp_summary

logger = logging.getLogger(__name__)

_QUICK_GREETING_REPLY = "\u60a8\u597d\uff0c\u6211\u5728\u3002\u8bf7\u76f4\u63a5\u544a\u8bc9\u6211\u60a8\u60f3\u54a8\u8be2\u7684\u95ee\u9898\u3002"
_QUICK_IDENTITY_REPLY = "\u6211\u662fHDMS\u95ee\u7b54\u52a9\u624b\uff0c\u4e13\u6ce8\u7247\u533a\u7ba1\u63a7\u8d44\u6599\u95ee\u7b54\u548c\u5efa\u8bbe\u5408\u89c4\u5efa\u8bae\u3002"


_PDF_KEY_RE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff]+")
_PDF_INDEX_LOCK = threading.Lock()
_PDF_AVAILABLE_KEYS: Optional[set[str]] = None

_PAGE_MARKER_RE = re.compile(r"<!--\s*PAGE\s*(\d+)\s*-->", flags=re.IGNORECASE)


def _infer_page_range_from_text(text: str) -> Tuple[Optional[int], Optional[int]]:
    """Infer 1-based page (and optional end page) from embedded markers like `<!-- PAGE 3 -->`."""
    if not text:
        return None, None
    pages: List[int] = []
    for m in _PAGE_MARKER_RE.finditer(text):
        try:
            n = int(m.group(1))
        except Exception:
            continue
        if n > 0:
            pages.append(n)
    if not pages:
        return None, None
    pages.sort()
    start = pages[0]
    end = pages[-1] if pages[-1] != start else None
    return start, end


_PAGE_RANGE_RE = re.compile(r"(\d{1,5})\s*(?:[-~—–至]\s*(\d{1,5}))?")


def _parse_page_like(value: object) -> Tuple[Optional[int], Optional[int]]:
    """Parse common page formats into (page, page_end)."""
    if value is None:
        return None, None
    if isinstance(value, int):
        return (value if value > 0 else None), None
    if isinstance(value, float):
        iv = int(value)
        return (iv if iv > 0 else None), None

    s = str(value).strip()
    if not s:
        return None, None

    # Examples: "第5页", "第5-7页", "5/20", "p5", "5-7"
    m = _PAGE_RANGE_RE.search(s)
    if not m:
        return None, None
    try:
        start = int(m.group(1))
    except Exception:
        return None, None
    if start <= 0:
        return None, None
    end_raw = m.group(2)
    if end_raw:
        try:
            end = int(end_raw)
        except Exception:
            end = None
        if end is not None and end > start:
            return start, end
    return start, None


def _find_project_root() -> Path:
    """Walk up from this file to find the directory containing .env."""
    for parent in Path(__file__).resolve().parents:
        if (parent / ".env").exists():
            return parent
    return Path(__file__).resolve().parent


def _normalize_pdf_key(name: str) -> str:
    base = Path(str(name or "")).name
    stem = base[:-4] if base.lower().endswith(".pdf") else Path(base).stem
    return _PDF_KEY_RE.sub("", stem).lower()


def _build_pdf_index(project_root: Path) -> set[str]:
    """
    Build a set of normalized keys for all PDFs present on disk.

    Used to ensure a strict invariant: any numbered citation source must have a local PDF.
    """
    roots = [
        project_root / "data" / "orginal_input",  # intentionally misspelled
        project_root / "data" / "original_input",
        project_root / "data" / "documents",
        project_root / "data" / "uploads",
    ]
    keys: set[str] = set()
    for root in roots:
        if not root.is_dir():
            continue
        try:
            for pdf in root.rglob("*.pdf"):
                if pdf.is_file():
                    keys.add(_normalize_pdf_key(pdf.name))
        except Exception:
            # Skip unreadable roots; caller will simply see fewer available PDFs.
            continue
    return keys


def _pdf_is_available(file_name: str) -> bool:
    """Return True if a local PDF matching the given filename is present in data roots."""
    global _PDF_AVAILABLE_KEYS
    key = _normalize_pdf_key(file_name)
    if not key:
        return False

    if _PDF_AVAILABLE_KEYS is None:
        with _PDF_INDEX_LOCK:
            if _PDF_AVAILABLE_KEYS is None:
                _PDF_AVAILABLE_KEYS = _build_pdf_index(_find_project_root())

    return key in (_PDF_AVAILABLE_KEYS or set())


class RAGService:
    """Service for RAG-based question answering."""

    def __init__(
        self,
        retriever: MultiSourceRetriever,
        llm_base_url: str,
        llm_api_key: str,
        llm_model: str
    ):
        self.retriever = retriever
        # Normalize base_url: ensure it ends with /v1
        base = llm_base_url.rstrip("/")
        if not base.endswith("/v1"):
            base = base + "/v1"
        self.llm_base_url = base
        self.llm_api_key = llm_api_key
        self.llm_model = llm_model

    def answer_question(
        self,
        question: str,
        history: Optional[List[Dict[str, str]]] = None,
        use_retrieval: bool = True,
        top_k: int = app_config.QA_DEFAULT_TOP_K
    ) -> Dict[str, Any]:
        """Answer a question using retrieval-augmented generation."""
        question = (question or "").strip()
        quick_reply = self._get_quick_reply(question)

        if quick_reply is not None:
            return {
                "answer": quick_reply,
                "sources": [],
                "context_used": False,
                "model": self.llm_model,
            }

        effective_use_retrieval = bool(use_retrieval)
        effective_top_k = self._normalize_top_k(top_k)
        retrieval_query = question
        retrieval_selection = rag_retrieval_mode.resolve_retrieval_selection(
            use_retrieval=effective_use_retrieval,
            raw_mode=getattr(app_config, "QA_RETRIEVAL_MODE", "hybrid"),
            allowed_modes=getattr(app_config, "QA_RETRIEVAL_MODES", getattr(app_config, "STREAM_RETRIEVAL_MODES", set())),
            default_mode="hybrid",
            allow_keyword=False,
        )
        effective_use_retrieval = retrieval_selection.enabled

        cache = get_query_cache()
        history_summary = self._build_history_summary(history)
        if effective_use_retrieval and app_config.QUERY_CACHE_ENABLED:
            cached = cache.get(question, history_summary)
            if cached is not None:
                logger.info("Returning cached answer for query")
                return cached

        context = ""
        sources: List[Dict[str, Any]] = []

        if effective_use_retrieval:
            retrieval_results = self.retriever.retrieve(
                query=retrieval_query,
                top_k=effective_top_k,
                use_vector=retrieval_selection.use_vector,
                use_graph=retrieval_selection.use_graph,
                use_keyword=retrieval_selection.use_keyword,
            )
            context, sources = self._build_context_and_sources(retrieval_results, query=retrieval_query)

        doc_nums = sorted({s["doc_num"] for s in sources if s.get("doc_num")})
        prompt = self._build_prompt(
            question,
            context,
            history,
            source_doc_nums=doc_nums,
            source_doc_required_labels=rag_prompting.build_doc_required_labels(sources),
        )
        answer = self._generate_answer(prompt)

        answer, sources = self._finalize_answer_and_sources(
            answer,
            sources,
            question=question,
            inject_summary_with_llm=True,
            missing_image_log="Answer mentions figures but no image-bearing sources survived filtering.",
        )

        result = {
            "answer": answer,
            "sources": sources,
            "context_used": bool(context),
            "model": self.llm_model,
        }

        if effective_use_retrieval and app_config.QUERY_CACHE_ENABLED:
            cache.put(question, result, history_summary)

        return result

    @staticmethod
    def _is_brief_greeting(question: str) -> bool:
        """Return True when the input is a pure greeting with no real question."""
        return rag_prompting.is_brief_greeting(question)

    @staticmethod
    def _is_identity_query(question: str) -> bool:
        """Return True when the user asks about assistant identity/capabilities."""
        return rag_prompting.is_identity_query(question)

    @staticmethod
    def _build_history_summary(history: Optional[List[Dict[str, str]]]) -> str:
        """Build a compact summary of recent history for cache key differentiation."""
        return rag_prompting.build_history_summary(history)

    @classmethod
    def _get_quick_reply(cls, question: str) -> Optional[str]:
        if cls._is_brief_greeting(question):
            return _QUICK_GREETING_REPLY
        if cls._is_identity_query(question):
            return _QUICK_IDENTITY_REPLY
        return None

    @staticmethod
    def _apply_citation_remap_to_sources(sources: List[Dict[str, Any]], remap: Dict[str, str]) -> None:
        if not remap:
            return
        for src in sources:
            old_label = src.get("citation_label", "")
            if old_label in remap:
                src["citation_label"] = remap[old_label]

    def _finalize_answer_and_sources(
        self,
        answer: str,
        sources: List[Dict[str, Any]],
        *,
        question: str,
        inject_summary_with_llm: bool,
        missing_image_log: str,
    ) -> Tuple[str, List[Dict[str, Any]]]:
        valid_labels = {s["citation_label"] for s in sources if s.get("citation_label")} or None
        processed, remap = pp_answer.postprocess_answer(answer, valid_labels)
        self._apply_citation_remap_to_sources(sources, remap)
        sources = pp_sources.filter_sources_to_referenced(
            sources,
            referenced_labels=pp_citations.extract_citation_labels(processed),
            keep_image_sources=True,
            keep_uncited_document_sources=True,
        )
        if ("见图" in (processed or "")) and not any(s.get("image_urls") or s.get("image_url") for s in sources):
            logger.warning(missing_image_log)
        if inject_summary_with_llm:
            processed = self._inject_summary_document_names_with_llm(processed, question, sources)
        else:
            processed = pp_summary.inject_summary_document_names(processed, sources)
        return processed, sources

    def _build_context_and_sources(
        self,
        retrieval_results: Dict[str, Any],
        query: str = "",
    ) -> Tuple[str, List[Dict[str, Any]]]:
        """Build aligned context and citation sources from retrieval results.

        Citation labels use N-M format where N is the document number and M is
        the chunk number within that document.  Graph sources use plain N.
        Each chunk becomes an independent source entry so the frontend can
        render fine-grained citations like [1-1|PDF] [1-2|PDF] [2-1|PDF].
        """
        return rag_context_builder.build_context_and_sources(
            retrieval_results=retrieval_results,
            query=query,
            mongo=getattr(self.retriever, "mongodb", None),
            ranked_results_contain_relevant_images=self._ranked_results_contain_relevant_images,
            search_image_chunks_by_text=self._search_image_chunks_by_text,
            extract_image_refs=pp_images.extract_image_refs,
            extract_image_figure_meta=pp_images.extract_image_figure_meta,
            rewrite_image_urls=pp_images.rewrite_image_urls,
            extract_first_markdown_table=pp_markdown.extract_first_markdown_table,
            pdf_is_available=_pdf_is_available,
            parse_page_like=_parse_page_like,
            infer_page_range_from_text=_infer_page_range_from_text,
        )

    @staticmethod
    def _ranked_results_contain_relevant_images(results: List[Dict[str, Any]], query: str) -> bool:
        """Return True when there is at least one image-bearing result likely relevant to the query."""
        return rag_retrieval.ranked_results_contain_relevant_images(results, query)

    def _search_image_chunks_by_text(self, query: str, limit: int = 2) -> List[Dict[str, Any]]:
        """Best-effort Mongo text search over chunks, restricted to has_image=True."""
        mongo = getattr(self.retriever, "mongodb", None)
        return rag_retrieval.search_image_chunks_by_text(mongo=mongo, query=query, limit=limit)

    def _build_prompt(
        self,
        question: str,
        context: str,
        history: Optional[List[Dict[str, str]]] = None,
        retrieval_hint: Optional[str] = None,
        source_doc_nums: Optional[List[int]] = None,
        source_doc_required_labels: Optional[Dict[int, str]] = None,
    ) -> List[Dict[str, str]]:
        """Build prompt for LLM generation."""
        return rag_prompting.build_prompt(
            question=question,
            context=context,
            history=history,
            retrieval_hint=retrieval_hint,
            source_doc_nums=source_doc_nums,
            source_doc_required_labels=source_doc_required_labels,
        )

    @staticmethod
    def _strip_think_tags(text: str) -> str:
        """Remove <think>...</think> blocks from text (for non-streaming)."""
        return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

    @staticmethod
    def _normalize_top_k(top_k: int) -> int:
        min_k = max(1, int(getattr(app_config, "QA_TOP_K_MIN", 1)))
        max_k = max(min_k, int(getattr(app_config, "QA_TOP_K_MAX", 20)))
        try:
            parsed_top_k = int(top_k)
        except (TypeError, ValueError):
            parsed_top_k = int(getattr(app_config, "QA_DEFAULT_TOP_K", min_k))
        return max(min_k, min(parsed_top_k, max_k))

    def _generate_summary_reasons_with_llm(
        self,
        question: str,
        summary_items: List[Dict[str, Any]],
    ) -> Optional[str]:
        """Use LLM to rewrite one overall summary line."""
        if not app_config.SUMMARY_REASON_LLM_REWRITE:
            return None
        if not summary_items:
            return None

        materials = [
            {
                "name": item["name"],
                "section": item["section"] or None,
                "page": item["page"] if isinstance(item.get("page"), int) else None,
            }
            for item in summary_items
        ]
        messages = [
            {
                "role": "system",
                "content": (
                    "你是资料综述润色助手。只能基于给定事实改写，不得新增事实，不要模板化套话。"
                    "输出严格JSON：{\"summary\":\"...\"}。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "question": question,
                        "materials": materials,
                    },
                    ensure_ascii=False,
                ),
            },
        ]
        raw = self._generate_answer(messages)
        obj = pp_summary.extract_first_json_object(raw)
        if obj:
            summary = str(obj.get("summary") or "").strip().replace("\n", " ")
            summary = re.sub(r"\s{2,}", " ", summary)[:120]
            if summary:
                return summary

        # Fallback for providers that return plain text instead of JSON.
        fallback = re.sub(r"^AI总结[:：]\s*", "", str(raw or "").strip())
        fallback = re.sub(r"```(?:json)?|```", "", fallback, flags=re.IGNORECASE).strip()
        fallback = re.sub(r"\s{2,}", " ", fallback)
        fallback = re.sub(r"^\{[\s\S]*\"summary\"\s*:\s*\"(.*?)\"[\s\S]*\}$", r"\1", fallback)
        fallback = fallback.strip().strip("\"' ")
        return fallback[:120] if fallback else None

    def _inject_summary_document_names_with_llm(
        self,
        answer: str,
        question: str,
        sources: List[Dict[str, Any]],
    ) -> str:
        if not answer:
            return answer
        if "涉及资料" in answer or "检索资料清单" in answer:
            return answer

        summary_items = pp_summary.collect_document_summary_items(sources)
        if not summary_items:
            return answer
        llm_summary = self._generate_summary_reasons_with_llm(question, summary_items)
        return pp_summary.inject_summary_document_names(
            answer,
            sources,
            llm_summary_override=llm_summary,
        )

    def _generate_answer(self, messages: List[Dict[str, str]]) -> str:
        """Generate answer using LLM (non-streaming)."""
        endpoint = f"{self.llm_base_url}/chat/completions"
        payload = {
            "model": self.llm_model,
            "messages": messages,
            "temperature": app_config.QA_LLM_TEMPERATURE,
            "max_tokens": app_config.QA_LLM_MAX_TOKENS,
        }

        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.llm_api_key}",
        }

        req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=app_config.QA_LLM_TIMEOUT_SECONDS) as response:
                body = response.read().decode("utf-8")
                result = json.loads(body)

            answer = result["choices"][0]["message"]["content"]
            # Strip <think> tags that reasoning models may include.
            answer = self._strip_think_tags(answer)
            logger.info("Generated answer: %s characters", len(answer))
            return answer
        except Exception as e:
            logger.error("Failed to generate answer: %s", e)
            return f"抱歉，生成答案时出错：{str(e)}"

    def _stream_chat_completion(
        self,
        messages: List[Dict[str, str]],
        *,
        max_tokens: int,
    ) -> Generator[Tuple[str, Dict[str, Any]], None, None]:
        """Stream one chat completion and emit thinking/answer events."""
        client = openai.OpenAI(
            base_url=self.llm_base_url,
            api_key=self.llm_api_key,
        )

        stream = client.chat.completions.create(
            model=self.llm_model,
            messages=messages,
            temperature=app_config.QA_LLM_TEMPERATURE,
            max_tokens=max_tokens,
            stream=True,
        )

        in_think_tag = False
        has_reasoning_content = False
        thinking_done_emitted = False

        for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            if not choice:
                continue

            delta = choice.delta
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                has_reasoning_content = True
                yield ("thinking", {"content": reasoning})

            content = delta.content
            if content and not has_reasoning_content:
                # Fallback parser for APIs that wrap reasoning in <think> tags.
                while content:
                    if not in_think_tag:
                        idx = content.find("<think>")
                        if idx == -1:
                            yield ("answer", {"content": content})
                            break
                        if idx > 0:
                            yield ("answer", {"content": content[:idx]})
                        in_think_tag = True
                        content = content[idx + 7:]
                    else:
                        idx = content.find("</think>")
                        if idx == -1:
                            yield ("thinking", {"content": content})
                            break
                        if idx > 0:
                            yield ("thinking", {"content": content[:idx]})
                        in_think_tag = False
                        if not thinking_done_emitted:
                            thinking_done_emitted = True
                            yield ("thinking_done", {})
                        content = content[idx + 8:]
            elif content and has_reasoning_content:
                if not thinking_done_emitted:
                    thinking_done_emitted = True
                    yield ("thinking_done", {})
                yield ("answer", {"content": content})

    def answer_question_stream(
        self,
        question: str,
        history: Optional[List[Dict[str, str]]] = None,
        use_retrieval: bool = True,
        top_k: int = app_config.QA_DEFAULT_TOP_K
    ) -> Generator[Tuple[str, Dict[str, Any]], None, None]:
        """
        Stream answer with retrieval-first UX:
        - Retrieve sources first, then stream the grounded answer.

        Flow:
        1) Send status event so frontend knows we're working.
        2) Run retrieval (if enabled), then emit sources/stats/graph events.
        3) Stream one grounded answer (thinking + answer) to avoid early answer tokens.
        """
        import time

        question = (question or "").strip()
        stream_start = time.perf_counter()
        logger.info("[TIMING] Stream started for question: %s...", question[:50])

        # --- Quick replies (greetings / identity) ---
        quick_reply = self._get_quick_reply(question)

        if quick_reply is not None:
            yield ("sources", {"sources": []})
            yield ("answer", {"content": quick_reply})
            yield ("done", {
                "model": self.llm_model,
                "context_used": False,
                "cached": False,
            })
            return

        # --- Retrieval config ---
        effective_use_retrieval = bool(use_retrieval)
        effective_top_k = self._normalize_top_k(top_k)
        retrieval_query = question

        stream_mode_raw = (getattr(app_config, "STREAM_RETRIEVAL_MODE", "") or "").strip().lower()
        if not stream_mode_raw:
            stream_mode_raw = getattr(app_config, "QA_RETRIEVAL_MODE", "hybrid")
        retrieval_selection = rag_retrieval_mode.resolve_retrieval_selection(
            use_retrieval=effective_use_retrieval,
            raw_mode=stream_mode_raw,
            allowed_modes=getattr(app_config, "QA_RETRIEVAL_MODES", getattr(app_config, "STREAM_RETRIEVAL_MODES", set())),
            default_mode="hybrid",
            allow_keyword=False,
        )
        effective_use_retrieval = retrieval_selection.enabled
        retrieval_mode = retrieval_selection.mode

        stream_top_k_cap = max(1, int(app_config.STREAM_RETRIEVAL_TOP_K_CAP))
        stream_top_k = max(1, min(effective_top_k, stream_top_k_cap))

        use_vector = retrieval_selection.use_vector
        use_graph = retrieval_selection.use_graph
        use_keyword = retrieval_selection.use_keyword

        # --- Cache check ---
        cache = get_query_cache()
        history_summary = self._build_history_summary(history)
        if effective_use_retrieval and app_config.QUERY_CACHE_ENABLED:
            cached = cache.get(question, history_summary)
            if cached is not None:
                logger.info("Returning cached answer via stream")
                yield ("sources", {"sources": cached.get("sources", [])})
                yield ("retrieval_stats", {
                    "vector_count": 0,
                    "graph_count": 0,
                    "keyword_count": 0,
                    "fused_count": 0,
                    "reranked": False,
                    "cached": True,
                    "weights": {},
                })
                yield ("answer", {"content": cached["answer"]})
                yield ("done", {
                    "model": cached.get("model", self.llm_model),
                    "context_used": cached.get("context_used", True),
                    "cached": True,
                })
                return

        # --- Retrieval phase ---
        context = ""
        sources: List[Dict[str, Any]] = []
        retrieval_results: Optional[Dict[str, Any]] = None

        full_answer_parts: List[str] = []

        try:
            if effective_use_retrieval:
                yield ("status", {"stage": "understanding", "message": "正在理解你的问题..."})
                yield ("status", {"stage": "retrieving", "message": "正在检索相关资料..."})
                retrieval_start = time.perf_counter()
                try:
                    retrieval_results = self.retriever.retrieve(
                        query=retrieval_query,
                        top_k=stream_top_k,
                        use_vector=use_vector,
                        use_graph=use_graph,
                        use_keyword=use_keyword,
                        enable_rerank=app_config.STREAM_ENABLE_RERANK,
                    )
                except Exception as e:
                    logger.error("Retrieval failed: %s", e)
                    yield ("error", {"detail": f"Retrieval failed: {e}"})
                    return

                retrieval_elapsed = (time.perf_counter() - retrieval_start) * 1000
                logger.info("[TIMING] Retrieval completed in %.2fms", retrieval_elapsed)

                context, sources = self._build_context_and_sources(retrieval_results or {}, query=retrieval_query)
                yield ("sources", {"sources": sources})

                stats_source = retrieval_results or {}
                yield ("retrieval_stats", {
                    "vector_count": len(stats_source.get("vector_results", [])),
                    "graph_count": len(stats_source.get("graph_results", [])),
                    "keyword_count": len(stats_source.get("keyword_results", [])),
                    "fused_count": len(stats_source.get("fused_results", [])),
                    "reranked": bool(stats_source.get("reranked", False)),
                    "cached": False,
                    "weights": self.retriever._compute_weights(retrieval_query),
                    "timed_out": False,
                    "mode": retrieval_mode,
                    "top_k": stream_top_k,
                })

                if retrieval_results is not None:
                    for gr in retrieval_results.get("graph_results", []):
                        if gr.get("type") == "subgraph" and gr.get("data"):
                            subgraph_data = gr["data"]
                            if subgraph_data.get("nodes"):
                                yield ("graph", {
                                    "nodes": subgraph_data["nodes"],
                                    "edges": subgraph_data.get("edges", []),
                                })
                            break

                yield ("status", {"stage": "reasoning", "message": "正在进行智能研判..."})
                doc_nums = sorted({s["doc_num"] for s in sources if s.get("doc_num")})
                prompt = self._build_prompt(
                    question,
                    context,
                    history,
                    retrieval_hint=None,
                    source_doc_nums=doc_nums,
                    source_doc_required_labels=rag_prompting.build_doc_required_labels(sources),
                )

                llm_start = time.perf_counter()
                first_token_received = False
                for event_type, payload in self._stream_chat_completion(
                    prompt,
                    max_tokens=app_config.QA_STREAM_MAX_TOKENS,
                ):
                    if event_type == "answer":
                        answer_piece = payload.get("content", "")
                        full_answer_parts.append(answer_piece)
                        if not first_token_received and answer_piece:
                            first_token_received = True
                            elapsed = (time.perf_counter() - llm_start) * 1000
                            total_elapsed = (time.perf_counter() - stream_start) * 1000
                            logger.info(
                                "[TIMING] First token after %.2fms (total %.2fms)",
                                elapsed,
                                total_elapsed,
                            )
                    yield (event_type, payload)
            else:
                # No retrieval: keep existing behavior (sources first, then answer).
                yield ("sources", {"sources": []})
                yield ("status", {"stage": "understanding", "message": "正在理解你的问题..."})
                yield ("status", {"stage": "reasoning", "message": "正在进行智能研判..."})
                prompt = self._build_prompt(question, context, history, retrieval_hint=None)

                llm_start = time.perf_counter()
                first_token_received = False
                for event_type, payload in self._stream_chat_completion(
                    prompt,
                    max_tokens=app_config.QA_STREAM_MAX_TOKENS,
                ):
                    if event_type == "answer":
                        answer_piece = payload.get("content", "")
                        full_answer_parts.append(answer_piece)
                        if not first_token_received and answer_piece:
                            first_token_received = True
                            elapsed = (time.perf_counter() - llm_start) * 1000
                            total_elapsed = (time.perf_counter() - stream_start) * 1000
                            logger.info(
                                "[TIMING] First token after %.2fms (total %.2fms)",
                                elapsed,
                                total_elapsed,
                            )
                    yield (event_type, payload)
        except Exception as e:
            logger.error("LLM streaming failed: %s", e)
            yield ("error", {"detail": str(e)})
            return

        # --- Post-process & emit corrected answer ---
        full_answer = "".join(full_answer_parts)
        processed = full_answer
        if full_answer:
            processed, sources = self._finalize_answer_and_sources(
                full_answer,
                sources,
                question=question,
                inject_summary_with_llm=False,
                missing_image_log="Streamed answer mentions figures but no image-bearing sources survived filtering.",
            )

            if processed != full_answer:
                # Bundle sources into answer_replaced so the frontend can
                # atomically update both content and citation labels,
                # avoiding race conditions between separate SSE events.
                yield ("answer_replaced", {"content": processed, "sources": sources})

        yield ("done", {
            "model": self.llm_model,
            "context_used": bool(context),
            "cached": False,
        })

        # --- Cache result ---
        if effective_use_retrieval and app_config.QUERY_CACHE_ENABLED:
            if processed:
                cache.put(question, {
                    "answer": processed,
                    "sources": sources,
                    "context_used": bool(context),
                    "model": self.llm_model,
                }, history_summary)

    def _extract_sources(self, retrieval_results: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Backwards-compatible wrapper for source extraction."""
        _, sources = self._build_context_and_sources(retrieval_results, query="")
        return sources



def create_rag_service(retriever: MultiSourceRetriever) -> RAGService:
    """
    Create RAG service from environment variables.

    Args:
        retriever: Multi-source retriever instance

    Returns:
        Configured RAGService instance
    """
    base_url = app_config.HDMS_BASE_URL
    api_key = app_config.HDMS_API_KEY
    model = app_config.HDMS_QA_MODEL

    if not api_key:
        raise ValueError("HDMS_API_KEY environment variable is required")

    return RAGService(retriever, base_url, api_key, model)
