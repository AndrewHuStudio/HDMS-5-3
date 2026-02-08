"""
RAG service for intelligent question answering.
"""

import json
import re
import urllib.request
from typing import List, Dict, Any, Optional, Generator, Tuple
import logging
import os

import openai

from rag.retriever import MultiSourceRetriever

logger = logging.getLogger(__name__)


class RAGService:
    """Service for RAG-based question answering."""

    def __init__(
        self,
        retriever: MultiSourceRetriever,
        llm_base_url: str,
        llm_api_key: str,
        llm_model: str
    ):
        """
        Initialize RAG service.

        Args:
            retriever: Multi-source retriever
            llm_base_url: LLM API base URL
            llm_api_key: LLM API key
            llm_model: LLM model name
        """
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
        """
        Answer a question using RAG.

        Args:
            question: User question
            history: Conversation history (list of {role, content})
            use_retrieval: Whether to use retrieval
            top_k: Number of retrieval results

        Returns:
            Dictionary with answer, sources, and metadata
        """
        # Retrieve context
        context = ""
        sources = []

        if use_retrieval:
            retrieval_results = self.retriever.retrieve(
                query=question,
                top_k=top_k
            )
            context = self.retriever.format_context(retrieval_results)
            sources = self._extract_sources(retrieval_results)

        # Build prompt
        prompt = self._build_prompt(question, context, history)

        # Generate answer
        answer = self._generate_answer(prompt)

        return {
            "answer": answer,
            "sources": sources,
            "context_used": bool(context),
            "model": self.llm_model
        }

    def _build_prompt(
        self,
        question: str,
        context: str,
        history: Optional[List[Dict[str, str]]] = None
    ) -> List[Dict[str, str]]:
        """
        Build prompt for LLM.

        Args:
            question: User question
            context: Retrieved context
            history: Conversation history

        Returns:
            List of messages for LLM
        """
        messages = []

        # System prompt
        system_prompt = """你是HDMS（高强度片区数字化管控平台）的智能问答助手。

你的职责：
1. 根据提供的参考资料回答用户问题
2. 回答要准确、简洁、结构清晰
3. 优先使用中文回答
4. 如果信息不足，明确说明需要哪些资料

引用规则（非常重要）：
- 参考资料中每条来源标记为 [1]、[2]、[3] 等
- 在回答中引用某条来源的信息时，必须在相关句子末尾标注对应编号，如 [1]、[2]
- 可以同时引用多个来源，如 [1][3]
- 不要编造来源编号，只使用参考资料中实际存在的编号

回答格式：
- 使用Markdown格式
- 重要信息用**加粗**
- 列表用 - 或数字
- 指标值要准确引用并标注来源"""

        messages.append({
            "role": "system",
            "content": system_prompt
        })

        # Add history (last 8 messages)
        if history:
            for msg in history[-8:]:
                messages.append({
                    "role": msg.get("role", "user"),
                    "content": msg.get("content", "")
                })

        # Add context and question
        user_message = ""
        if context:
            user_message += f"参考资料：\n\n{context}\n\n---\n\n"

        user_message += f"问题：{question}"

        messages.append({
            "role": "user",
            "content": user_message
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
            "max_tokens": 2000
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

    def answer_question_stream(
        self,
        question: str,
        history: Optional[List[Dict[str, str]]] = None,
        use_retrieval: bool = True,
        top_k: int = 5
    ) -> Generator[Tuple[str, Dict[str, Any]], None, None]:
        """
        Stream answer using RAG with SSE events.

        Yields (event_type, data) tuples:
        - ("sources", {"sources": [...]})
        - ("thinking", {"content": "..."})
        - ("answer", {"content": "..."})
        - ("done", {"model": ..., "context_used": ...})
        - ("error", {"detail": "..."})
        """
        # Step 1: Retrieve context (synchronous, before streaming)
        context = ""
        sources = []

        if use_retrieval:
            try:
                retrieval_results = self.retriever.retrieve(
                    query=question,
                    top_k=top_k
                )
                context = self.retriever.format_context(retrieval_results)
                sources = self._extract_sources(retrieval_results)
            except Exception as e:
                logger.error(f"Retrieval failed: {e}")
                yield ("error", {"detail": f"Retrieval failed: {e}"})
                return

        # Step 2: Yield sources event first
        yield ("sources", {"sources": sources})

        # Step 3: Build prompt
        prompt = self._build_prompt(question, context, history)

        # Step 4: Stream LLM response using OpenAI SDK
        client = openai.OpenAI(
            base_url=self.llm_base_url,
            api_key=self.llm_api_key,
        )

        # Track whether we're inside <think> tags (fallback for APIs
        # that don't support reasoning_content field)
        in_think_tag = False
        has_reasoning_content = False

        try:
            stream = client.chat.completions.create(
                model=self.llm_model,
                messages=prompt,
                temperature=0.3,
                max_tokens=4000,
                stream=True,
            )

            for chunk in stream:
                choice = chunk.choices[0] if chunk.choices else None
                if not choice:
                    continue
                delta = choice.delta

                # DeepSeek-R1: reasoning_content field for thinking
                reasoning = getattr(delta, "reasoning_content", None)
                if reasoning:
                    has_reasoning_content = True
                    yield ("thinking", {"content": reasoning})

                content = delta.content
                if content and not has_reasoning_content:
                    # Fallback: parse <think>...</think> tags in content
                    # when the API does not provide reasoning_content
                    while content:
                        if not in_think_tag:
                            idx = content.find("<think>")
                            if idx == -1:
                                yield ("answer", {"content": content})
                                break
                            if idx > 0:
                                yield ("answer", {"content": content[:idx]})
                            in_think_tag = True
                            content = content[idx + 7:]  # len("<think>") == 7
                        else:
                            idx = content.find("</think>")
                            if idx == -1:
                                yield ("thinking", {"content": content})
                                break
                            if idx > 0:
                                yield ("thinking", {"content": content[:idx]})
                            in_think_tag = False
                            content = content[idx + 8:]  # len("</think>") == 8
                elif content and has_reasoning_content:
                    # API provides reasoning_content, so content is the answer
                    yield ("answer", {"content": content})

                if choice.finish_reason:
                    yield ("done", {
                        "model": self.llm_model,
                        "context_used": bool(context),
                    })

        except Exception as e:
            logger.error(f"Streaming generation failed: {e}")
            yield ("error", {"detail": str(e)})

    def _extract_sources(self, retrieval_results: Dict[str, Any]) -> List[Dict[str, str]]:
        """
        Extract source information from retrieval results.
        Keeps chunk-level granularity so each [1], [2] maps to a specific chunk.

        Args:
            retrieval_results: Results from retriever

        Returns:
            List of source dictionaries
        """
        sources = []
        seen_ids = set()

        # Extract from vector results (per-chunk, with chunk_id)
        for result in retrieval_results.get("vector_results", [])[:5]:
            chunk_id = result.get("id", "")
            if chunk_id and chunk_id not in seen_ids:
                metadata = result.get("metadata", {})
                sources.append({
                    "type": "document",
                    "name": metadata.get("file_name", ""),
                    "section": metadata.get("section_title", ""),
                    "source": "vector_search",
                    "chunk_id": chunk_id,
                })
                seen_ids.add(chunk_id)

        # Extract from graph results
        for result in retrieval_results.get("graph_results", []):
            if result.get("type") == "plot_info":
                plot_name = result.get("plot_name", "")
                if plot_name and plot_name not in seen_ids:
                    sources.append({
                        "type": "plot",
                        "name": plot_name,
                        "section": None,
                        "source": "knowledge_graph",
                        "chunk_id": None,
                    })
                    seen_ids.add(plot_name)

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
