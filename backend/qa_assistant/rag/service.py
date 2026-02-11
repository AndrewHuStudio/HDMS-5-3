"""
RAG service for intelligent question answering.
"""

import concurrent.futures
import json
import re
import urllib.request
from urllib.parse import quote
from typing import List, Dict, Any, Optional, Generator, Tuple
import logging
import os

import openai

from core import config as app_config
from rag.retriever import MultiSourceRetriever
from rag.cache import get_query_cache

logger = logging.getLogger(__name__)

# Run retrieval in background so stream output can start immediately.
_STREAM_RETRIEVE_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=4)


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
        top_k: int = 5
    ) -> Dict[str, Any]:
        """Answer a question using retrieval-augmented generation."""
        effective_use_retrieval = bool(use_retrieval)
        effective_top_k = max(1, min(top_k, 20))
        retrieval_query = question

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
            )
            context, sources = self._build_context_and_sources(retrieval_results)

        prompt = self._build_prompt(question, context, history)
        answer = self._generate_answer(prompt)

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
    def _build_history_summary(history: Optional[List[Dict[str, str]]]) -> str:
        """Build a compact summary of recent history for cache key differentiation."""
        if not history:
            return ""
        user_msgs = [
            msg["content"][:50]
            for msg in history[-4:]
            if msg.get("role") == "user" and msg.get("content", "").strip()
        ]
        return "|".join(user_msgs[-2:])

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @classmethod
    def _extract_image_refs(cls, markdown_text: str) -> List[str]:
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

            alt_end = cls._find_matching_bracket(markdown, marker_idx + 1, "[", "]")
            if alt_end == -1:
                idx = marker_idx + len(marker)
                continue

            pos = alt_end + 1
            while pos < length and markdown[pos].isspace():
                pos += 1

            if pos >= length or markdown[pos] != "(":
                idx = marker_idx + len(marker)
                continue

            raw_ref, next_idx = cls._extract_parenthesized(markdown, pos)
            if raw_ref is None:
                idx = marker_idx + len(marker)
                continue

            ref = cls._strip_image_ref(raw_ref)
            if ref and not ref.lower().startswith(("http://", "https://", "data:")) and ref not in seen:
                seen.add(ref)
                refs.append(ref)

            idx = next_idx

        return refs

    @classmethod
    def _extract_primary_image_ref(cls, text: str) -> Optional[str]:
        """Extract the first local markdown image reference from chunk text."""
        refs = cls._extract_image_refs(text)
        return refs[0] if refs else None

    @classmethod
    def _rewrite_image_urls(cls, text: str, doc_id: str) -> str:
        """Replace all local ![alt](path) refs with accessible API URLs.

        Skips refs that are already http/https/data URLs.
        Returns the rewritten text.
        """
        if not text or not doc_id:
            return text

        result_parts: list[str] = []
        idx = 0
        markdown = text
        marker = "!["
        length = len(markdown)

        while idx < length:
            marker_idx = markdown.find(marker, idx)
            if marker_idx == -1:
                result_parts.append(markdown[idx:])
                break

            result_parts.append(markdown[idx:marker_idx])

            alt_end = cls._find_matching_bracket(markdown, marker_idx + 1, "[", "]")
            if alt_end == -1:
                result_parts.append(marker)
                idx = marker_idx + len(marker)
                continue

            alt_text = markdown[marker_idx + 2:alt_end]

            pos = alt_end + 1
            while pos < length and markdown[pos].isspace():
                pos += 1

            if pos >= length or markdown[pos] != "(":
                result_parts.append(markdown[marker_idx:pos])
                idx = pos
                continue

            raw_ref, next_idx = cls._extract_parenthesized(markdown, pos)
            if raw_ref is None:
                result_parts.append(markdown[marker_idx:next_idx])
                idx = next_idx
                continue

            ref = cls._strip_image_ref(raw_ref)

            if ref and not ref.lower().startswith(("http://", "https://", "data:")):
                api_url = f"/rag/documents/{doc_id}/image?ref={quote(ref)}"
                result_parts.append(f"![{alt_text}]({api_url})")
            else:
                result_parts.append(markdown[marker_idx:next_idx])

            idx = next_idx

        return "".join(result_parts)

    def _build_context_and_sources(self, retrieval_results: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]]]:
        """Build aligned context and citation sources from retrieval results."""
        ranked_results = retrieval_results.get("fused_results") or []
        if not ranked_results:
            ranked_results = [
                *retrieval_results.get("vector_results", []),
                *retrieval_results.get("graph_results", []),
                *retrieval_results.get("keyword_results", []),
            ]

        seen_doc_keys: set[str] = set()
        seen_graph_keys: set[str] = set()
        doc_blocks: List[str] = []
        graph_blocks: List[str] = []
        sources: List[Dict[str, Any]] = []
        idx = 1

        for result in ranked_results:
            source_type = str(result.get("source") or "")
            result_type = str(result.get("type") or "")

            # Skip visualization-only entries (subgraph, concept_match)
            if result_type in ("subgraph", "concept_match"):
                continue

            is_graph = source_type == "graph" or result_type in {"plot_info", "indicator_search"}

            if is_graph:
                if result_type == "plot_info":
                    plot_name = str(result.get("plot_name") or "").strip()
                    if not plot_name or plot_name in seen_graph_keys:
                        continue
                    seen_graph_keys.add(plot_name)

                    data = result.get("data", {}) or {}
                    lines = [f"[{idx}] 地块 {plot_name}："]
                    indicators = data.get("indicators", []) if isinstance(data, dict) else []
                    if indicators:
                        lines.append("指标：")
                        for ind in indicators[:6]:
                            if ind.get("indicator"):
                                lines.append(f"  - {ind['indicator']}: {ind.get('value', '未指定')}")

                    graph_blocks.append("\n".join(lines))
                    sources.append({
                        "type": "plot",
                        "name": plot_name,
                        "section": None,
                        "source": "knowledge_graph",
                        "chunk_id": None,
                        "doc_id": None,
                        "chunk_index": None,
                        "page": None,
                        "page_end": None,
                        "score": None,
                        "quote": None,
                        "pdf_url": None,
                        "image_url": None,
                        "image_name": None,
                    })
                    idx += 1
                    continue

                indicator = str(result.get("indicator") or "").strip()
                graph_key = f"indicator:{indicator}" if indicator else f"graph:{len(graph_blocks)}"
                if graph_key in seen_graph_keys:
                    continue
                seen_graph_keys.add(graph_key)

                data = result.get("data", [])
                lines = [f"[{idx}] 指标查询：{indicator or '图谱结果'}"]
                if isinstance(data, list):
                    for item in data[:5]:
                        if not isinstance(item, dict):
                            continue
                        plot_name = item.get("plot_name")
                        value = item.get("value")
                        if plot_name:
                            lines.append(f"  - {plot_name}: {value if value is not None else '未指定'}")

                graph_blocks.append("\n".join(lines))
                sources.append({
                    "type": "graph",
                    "name": indicator or "图谱结果",
                    "section": None,
                    "source": "knowledge_graph",
                    "chunk_id": None,
                    "doc_id": None,
                    "chunk_index": None,
                    "page": None,
                    "page_end": None,
                    "score": None,
                    "quote": None,
                    "pdf_url": None,
                    "image_url": None,
                    "image_name": None,
                })
                idx += 1
                continue

            text = str(result.get("text", "") or "").strip()
            if not text:
                continue

            chunk_id = str(result.get("id") or result.get("_id") or "").strip()
            dedup_key = chunk_id or text[:120]
            if dedup_key in seen_doc_keys:
                continue
            seen_doc_keys.add(dedup_key)

            metadata = result.get("metadata", {}) or {}
            doc_id = result.get("doc_id")
            file_name = metadata.get("file_name") or result.get("file_name") or "未知文档"
            section = metadata.get("section_title") or result.get("section_title") or ""

            raw_page = (
                metadata.get("page")
                or metadata.get("page_number")
                or metadata.get("page_num")
                or result.get("page")
                or result.get("page_number")
            )
            page: Optional[int] = None
            if isinstance(raw_page, int):
                page = raw_page
            elif isinstance(raw_page, str) and raw_page.isdigit():
                page = int(raw_page)

            raw_page_end = (
                metadata.get("page_end")
                or result.get("page_end")
            )
            page_end: Optional[int] = None
            if isinstance(raw_page_end, int):
                page_end = raw_page_end
            elif isinstance(raw_page_end, str) and raw_page_end.isdigit():
                page_end = int(raw_page_end)

            raw_score = result.get("weighted_score", result.get("score"))
            score: Optional[float] = None
            if isinstance(raw_score, (int, float)):
                score = float(raw_score)

            quote_text = text[:260] + ("..." if len(text) > 260 else "")
            pdf_url = (
                metadata.get("pdf_url")
                or metadata.get("pdf_path")
                or metadata.get("source_pdf_url")
                or metadata.get("source_pdf_path")
                or (f"/rag/documents/{doc_id}/pdf" if doc_id else None)
            )

            image_refs = self._extract_image_refs(text)
            image_ref = image_refs[0] if image_refs else None
            image_url = f"/rag/documents/{doc_id}/image?ref={quote(image_ref)}" if (doc_id and image_ref) else None
            image_name = image_ref.split("/")[-1] if image_ref else None

            # Rewrite local image paths to accessible API URLs before truncation
            rewritten_text = self._rewrite_image_urls(text, doc_id) if doc_id else text
            display_text = rewritten_text[:1200]
            if len(rewritten_text) > 1200:
                display_text += "..."
            section_label = f" - {section}" if section else ""

            doc_blocks.append(
                f"[{idx}] 来源：{file_name}{section_label}\n{display_text}"
            )

            source_name = "vector_search" if source_type == "vector" else (
                "keyword_search" if source_type == "keyword" else "document_search"
            )

            sources.append({
                "type": "document",
                "name": file_name,
                "section": section,
                "source": source_name,
                "chunk_id": chunk_id or None,
                "doc_id": doc_id,
                "chunk_index": result.get("chunk_index"),
                "page": page,
                "page_end": page_end,
                "score": score,
                "quote": quote_text,
                "pdf_url": pdf_url,
                "image_url": image_url,
                "image_name": image_name,
            })
            idx += 1

        context = ""
        if doc_blocks:
            context += "## 相关文档内容\n\n"
            context += "\n\n".join(doc_blocks)
            context += "\n\n"

        if graph_blocks:
            context += "## 知识图谱信息\n\n"
            context += "\n\n".join(graph_blocks)
            context += "\n\n"

        return context, sources

    def _build_prompt(
        self,
        question: str,
        context: str,
        history: Optional[List[Dict[str, str]]] = None,
        retrieval_hint: Optional[str] = None,
    ) -> List[Dict[str, str]]:
        """Build prompt for LLM generation."""
        messages: List[Dict[str, str]] = []

        system_prompt = (
            "作为数字化管控软件，基于上传片区管控资料智能问答，辅助空间优化，提供建设建议与合规核查"
        )

        messages.append({"role": "system", "content": system_prompt})

        if history:
            for msg in history[-8:]:
                messages.append({
                    "role": msg.get("role", "user"),
                    "content": msg.get("content", ""),
                })

        user_message = ""

        if retrieval_hint:
            user_message += retrieval_hint + "\n\n"

        if context:
            user_message += f"参考资料：\n\n{context}\n\n---\n\n"
        elif not retrieval_hint:
            user_message += "当前未检索到直接相关的参考资料，请运用你的专业知识回答。\n\n"

        user_message += f"问题：{question}"
        messages.append({"role": "user", "content": user_message})

        return messages

    def _build_followup_prompt(
        self,
        question: str,
        context: str,
        draft_answer: str,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> List[Dict[str, str]]:
        """Build continuation prompt after retrieval is ready."""
        messages = self._build_prompt(
            question,
            context,
            history,
            retrieval_hint=(
                "你已先输出了一个简短开场。请在已有输出基础上继续作答，"
                "不要重复已说过的句子，重点补充基于资料的结论与依据。"
            ),
        )

        if draft_answer.strip():
            messages.append({"role": "assistant", "content": draft_answer})
            messages.append({
                "role": "user",
                "content": (
                    "请继续完善答案。要求：\n"
                    "1) 优先依据参考资料给出结论；\n"
                    "2) 有依据时按[1][2]引用；\n"
                    "3) 若资料不足，明确不确定性并给出审慎建议；\n"
                    "4) 不要重复已经输出过的开场。"
                ),
            })

        return messages

    @staticmethod
    def _strip_think_tags(text: str) -> str:
        """Remove <think>...</think> blocks from text (for non-streaming)."""
        return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

    def _generate_answer(self, messages: List[Dict[str, str]]) -> str:
        """
        Generate answer using LLM.

        Args:
            messages: List of messages

        Returns:
            Generated answer
        """
        endpoint = f"{self.llm_base_url}/chat/completions"
        payload = {
            "model": self.llm_model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": 4096
        }

        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.llm_api_key}"
        }

        req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                body = response.read().decode("utf-8")
                result = json.loads(body)

            answer = result["choices"][0]["message"]["content"]
            # Strip <think> tags that reasoning models may include
            answer = self._strip_think_tags(answer)
            logger.info(f"Generated answer: {len(answer)} characters")
            return answer

        except Exception as e:
            logger.error(f"Failed to generate answer: {e}")
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
            temperature=0.3,
            max_tokens=max_tokens,
            stream=True,
        )

        in_think_tag = False
        has_reasoning_content = False

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
                        content = content[idx + 8:]
            elif content and has_reasoning_content:
                yield ("answer", {"content": content})

    def answer_question_stream(
        self,
        question: str,
        history: Optional[List[Dict[str, str]]] = None,
        use_retrieval: bool = True,
        top_k: int = 5
    ) -> Generator[Tuple[str, Dict[str, Any]], None, None]:
        """
        Stream answer with immediate response + parallel retrieval.

        Flow:
        1) Start a short prelude answer immediately.
        2) Run retrieval in parallel.
        3) Continue with retrieval-grounded completion.
        """
        import time

        stream_start = time.perf_counter()
        logger.info("[TIMING] Stream started for question: %s...", question[:50])

        effective_use_retrieval = bool(use_retrieval)
        effective_top_k = max(1, min(top_k, 20))
        retrieval_query = question

        retrieval_mode = (app_config.STREAM_RETRIEVAL_MODE or "vector").strip().lower()
        if retrieval_mode not in {"vector", "vector_only", "hybrid", "all", "none", "off", "disabled"}:
            retrieval_mode = "vector"

        if retrieval_mode in {"none", "off", "disabled"}:
            effective_use_retrieval = False

        stream_top_k_cap = max(1, int(app_config.STREAM_RETRIEVAL_TOP_K_CAP))
        stream_top_k = max(1, min(effective_top_k, stream_top_k_cap))

        use_vector = retrieval_mode in {"vector", "vector_only", "hybrid", "all"}
        use_graph = retrieval_mode in {"hybrid", "all"}
        use_keyword = retrieval_mode in {"hybrid", "all"}

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

        retrieval_future: Optional[concurrent.futures.Future] = None
        retrieval_results: Optional[Dict[str, Any]] = None
        context = ""
        sources: List[Dict[str, Any]] = []

        if effective_use_retrieval:
            retrieval_kwargs = {
                "query": retrieval_query,
                "top_k": stream_top_k,
                "use_vector": use_vector,
                "use_graph": use_graph,
                "use_keyword": use_keyword,
                "enable_rerank": app_config.STREAM_ENABLE_RERANK,
            }
            retrieval_future = _STREAM_RETRIEVE_EXECUTOR.submit(self.retriever.retrieve, **retrieval_kwargs)

        full_answer_parts: List[str] = []
        prelude_prompt = self._build_prompt(
            question,
            context="",
            history=history,
            retrieval_hint=(
                "请先用1-2句话快速响应用户问题，并明确说明你正在检索资料，"
                "稍后会补充基于资料的完整答案。不要编造具体条文。"
                if effective_use_retrieval
                else None
            ),
        )

        try:
            llm_start = time.perf_counter()
            first_token_received = False
            for event_type, payload in self._stream_chat_completion(prelude_prompt, max_tokens=220):
                if event_type == "answer":
                    full_answer_parts.append(payload.get("content", ""))
                    if not first_token_received:
                        first_token_received = True
                        elapsed = (time.perf_counter() - llm_start) * 1000
                        total_elapsed = (time.perf_counter() - stream_start) * 1000
                        logger.info(
                            "[TIMING] First prelude token received after %.2fms (total %.2fms)",
                            elapsed,
                            total_elapsed,
                        )
                yield (event_type, payload)
        except Exception as e:
            logger.error("Prelude streaming failed: %s", e)
            yield ("error", {"detail": str(e)})
            return

        prelude_answer = "".join(full_answer_parts)

        if effective_use_retrieval and retrieval_future is not None:
            retrieval_start = time.perf_counter()
            try:
                retrieval_results = retrieval_future.result()
                retrieval_elapsed = (time.perf_counter() - retrieval_start) * 1000
                logger.info("[TIMING] Retrieval joined in %.2fms", retrieval_elapsed)
                if retrieval_results is not None:
                    context, sources = self._build_context_and_sources(retrieval_results)
            except Exception as e:
                logger.error("Retrieval failed: %s", e)
                yield ("error", {"detail": f"Retrieval failed: {e}"})
                return

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

            followup_prompt = self._build_followup_prompt(
                question=question,
                context=context,
                draft_answer=prelude_answer,
                history=history,
            )
            try:
                for event_type, payload in self._stream_chat_completion(followup_prompt, max_tokens=4096):
                    if event_type == "answer":
                        full_answer_parts.append(payload.get("content", ""))
                    yield (event_type, payload)
            except Exception as e:
                logger.error("Follow-up streaming failed: %s", e)
                yield ("error", {"detail": str(e)})
                return
        else:
            yield ("sources", {"sources": []})

        yield ("done", {
            "model": self.llm_model,
            "context_used": bool(context),
            "cached": False,
        })

        if effective_use_retrieval and app_config.QUERY_CACHE_ENABLED:
            full_answer = "".join(full_answer_parts)
            if full_answer:
                cache.put(question, {
                    "answer": full_answer,
                    "sources": sources,
                    "context_used": bool(context),
                    "model": self.llm_model,
                }, history_summary)

    def _extract_sources(self, retrieval_results: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Backwards-compatible wrapper for source extraction."""
        _, sources = self._build_context_and_sources(retrieval_results)
        return sources



def create_rag_service(retriever: MultiSourceRetriever) -> RAGService:
    """
    Create RAG service from environment variables.

    Args:
        retriever: Multi-source retriever instance

    Returns:
        Configured RAGService instance
    """
    base_url = os.getenv("HDMS_BASE_URL", "https://api.apiyi.com")
    api_key = os.getenv("HDMS_API_KEY", "")
    model = os.getenv("HDMS_MODEL", "deepseek-v3")

    if not api_key:
        raise ValueError("HDMS_API_KEY environment variable is required")

    return RAGService(retriever, base_url, api_key, model)

