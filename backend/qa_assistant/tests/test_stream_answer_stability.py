import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rag.service import RAGService


class _DummyRetriever:
    pass


class _StableStreamingRAGService(RAGService):
    def __init__(self) -> None:
        super().__init__(
            retriever=_DummyRetriever(),
            llm_base_url="http://example.com",
            llm_api_key="test-key",
            llm_model="test-model",
        )
        self.raw_answer = "## 设计要点\n\n- 首层界面连续\n- 二层连桥衔接"
        self.final_answer = "## 设计要点\n\n1. 首层界面连续\n2. 二层连桥衔接"

    def _build_prompt(self, question, context, history=None, retrieval_hint=None, source_doc_nums=None, source_doc_required_labels=None):
        return [{"role": "user", "content": question}]

    def _stream_chat_completion(self, messages, *, max_tokens):
        yield ("thinking", {"content": "先分析约束。"})
        yield ("thinking_done", {})
        for chunk in ["## 设计要点\n\n", "- 首层界面连续\n", "- 二层连桥衔接"]:
            yield ("answer", {"content": chunk})

    def _finalize_answer_and_sources(self, answer, sources, *, question, missing_image_log):
        return self.final_answer, sources


class StreamAnswerStabilityTests(unittest.TestCase):
    def test_stream_answer_keeps_incremental_tokens_and_emits_final_replacement(self):
        service = _StableStreamingRAGService()

        events = list(
            service.answer_question_stream(
                question="请总结设计要点",
                history=[],
                use_retrieval=False,
                top_k=5,
            )
        )

        event_names = [name for name, _ in events]
        streamed_answer = "".join(
            payload.get("content", "")
            for name, payload in events
            if name == "answer"
        )
        replacement_payloads = [
            payload
            for name, payload in events
            if name == "answer_replaced"
        ]

        self.assertIn("thinking", event_names)
        self.assertIn("thinking_done", event_names)
        self.assertIn("done", event_names)
        self.assertEqual(service.raw_answer, streamed_answer)
        self.assertEqual(1, len(replacement_payloads))
        self.assertEqual(service.final_answer, replacement_payloads[0].get("content"))


if __name__ == "__main__":
    unittest.main()
