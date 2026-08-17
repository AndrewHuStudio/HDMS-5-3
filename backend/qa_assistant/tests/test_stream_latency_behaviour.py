import asyncio
import sys
import unittest
from pathlib import Path

QA_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]
for path in (QA_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from fastapi.responses import StreamingResponse

from rag.service import RAGService
from routes import qa as qa_routes
from schemas.rag_schemas import RAGChatRequest


class _DummyRetriever:
    pass


class _OverviewLatencyService(RAGService):
    def __init__(self) -> None:
        super().__init__(
            retriever=_DummyRetriever(),
            llm_base_url="http://example.com",
            llm_api_key="test-key",
            llm_model="test-model",
        )

    def _build_context_and_sources(self, retrieval_results, query=""):
        return "context", [
            {
                "type": "document",
                "name": "示例.pdf",
                "source": "vector",
                "doc_num": 1,
                "citation_label": "1-1",
            }
        ]

    def _build_retrieval_overview_text(self, **kwargs):
        return "## 检索综述\n\n已找到可用依据。\n\n"

    def _build_prompt(
        self,
        question,
        context,
        history=None,
        retrieval_hint=None,
        source_doc_nums=None,
        source_doc_required_labels=None,
    ):
        return [{"role": "user", "content": question}]

    def _stream_chat_completion(self, messages, *, max_tokens):
        yield ("thinking", {"content": "正在推理，尚未输出答案。"})
        yield ("thinking", {"content": "继续推理。"})
        yield ("thinking_done", {})
        yield ("answer", {"content": "正式答案。"})

    def _finalize_answer_and_sources(self, answer, sources, *, question, missing_image_log):
        return answer, sources


class StreamLatencyBehaviourTests(unittest.TestCase):
    def test_chat_stream_returns_streaming_response_before_retriever_setup(self):
        calls = []

        def fake_create_retriever():
            calls.append("create_retriever")
            return _DummyRetriever()

        def fake_create_service(retriever):
            calls.append("create_service")
            return _OverviewLatencyService()

        try:
            original_create_retriever = qa_routes._create_retriever
            original_create_service = qa_routes.create_rag_service
            qa_routes._create_retriever = fake_create_retriever
            qa_routes.create_rag_service = fake_create_service
            response = qa_routes.chat_stream(
                RAGChatRequest(
                    question="请分析首层公共空间管控要求",
                    history=[],
                    use_retrieval=False,
                    top_k=1,
                )
            )

            self.assertIsInstance(response, StreamingResponse)
            self.assertEqual([], calls)

            first_chunk = asyncio.run(response.body_iterator.__anext__())
            self.assertIn("event: status", first_chunk.decode() if isinstance(first_chunk, bytes) else first_chunk)
            self.assertEqual([], calls)
        finally:
            qa_routes._create_retriever = original_create_retriever
            qa_routes.create_rag_service = original_create_service

    def test_retrieval_overview_is_emitted_after_thinking_completes(self):
        service = _OverviewLatencyService()
        service.retriever = type(
            "Retriever",
            (),
            {
                "retrieve": lambda self, **kwargs: {
                    "vector_results": [{"id": "chunk-1", "text": "依据内容", "source": "vector"}],
                    "graph_results": [],
                    "keyword_results": [],
                    "fused_results": [{"id": "chunk-1", "text": "依据内容", "source": "vector"}],
                    "reranked": False,
                    "timed_out": False,
                    "timed_out_branches": [],
                },
                "_compute_weights": lambda self, query: {"vector": 1.0, "graph": 0.0, "keyword": 0.0},
            },
        )()

        events = list(
            service.answer_question_stream(
                question="请分析首层公共空间管控要求",
                history=[],
                use_retrieval=True,
                top_k=1,
            )
        )

        thinking_done_index = next(i for i, (name, _) in enumerate(events) if name == "thinking_done")
        overview_index = next(
            i
            for i, (name, payload) in enumerate(events)
            if name == "answer" and "检索综述" in payload.get("content", "")
        )
        formal_answer_index = next(
            i
            for i, (name, payload) in enumerate(events)
            if name == "answer" and payload.get("content") == "正式答案。"
        )

        self.assertLess(thinking_done_index, overview_index)
        self.assertLess(overview_index, formal_answer_index)


if __name__ == "__main__":
    unittest.main()
