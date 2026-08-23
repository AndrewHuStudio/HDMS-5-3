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

    @staticmethod
    def _attach_stub_retriever(service):
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
        return service

    @staticmethod
    def _overview_index(events) -> int:
        return next(
            i
            for i, (name, payload) in enumerate(events)
            if name == "answer" and "检索综述" in payload.get("content", "")
        )

    def _run_stream(self, service):
        return list(
            service.answer_question_stream(
                question="请分析首层公共空间管控要求",
                history=[],
                use_retrieval=True,
                top_k=1,
            )
        )

    def test_retrieval_overview_is_emitted_after_llm_reasoning_tokens(self):
        events = self._run_stream(self._attach_stub_retriever(_OverviewLatencyService()))

        thinking_indexes = [i for i, (name, _) in enumerate(events) if name == "thinking"]
        overview_index = self._overview_index(events)
        answer_indexes = [i for i, (name, _) in enumerate(events) if name == "answer"]

        # Reasoning streams first so the user sees movement immediately.
        self.assertTrue(thinking_indexes)
        self.assertGreater(overview_index, max(thinking_indexes))
        # The overview still leads the answer body, keeping it at the top of the text.
        self.assertEqual(overview_index, min(answer_indexes))

    def test_retrieval_overview_leads_answer_when_model_skips_reasoning(self):
        class _NoThinkingService(_OverviewLatencyService):
            def _stream_chat_completion(self, messages, *, max_tokens):
                yield ("answer", {"content": "直接给出答案。"})

        events = self._run_stream(self._attach_stub_retriever(_NoThinkingService()))

        answer_indexes = [i for i, (name, _) in enumerate(events) if name == "answer"]
        self.assertEqual(self._overview_index(events), min(answer_indexes))

    def test_retrieval_overview_is_still_emitted_when_model_returns_no_answer(self):
        class _ThinkingOnlyService(_OverviewLatencyService):
            def _stream_chat_completion(self, messages, *, max_tokens):
                yield ("thinking", {"content": "只有推理，没有答案。"})
                yield ("thinking_done", {})

        events = self._run_stream(self._attach_stub_retriever(_ThinkingOnlyService()))

        thinking_indexes = [i for i, (name, _) in enumerate(events) if name == "thinking"]
        overview_index = self._overview_index(events)
        done_index = next(i for i, (name, _) in enumerate(events) if name == "done")

        self.assertGreater(overview_index, max(thinking_indexes))
        self.assertLess(overview_index, done_index)


if __name__ == "__main__":
    unittest.main()
