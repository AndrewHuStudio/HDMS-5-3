import sys
import unittest
from pathlib import Path


QA_ROOT = Path(__file__).resolve().parents[1]
if str(QA_ROOT) not in sys.path:
    sys.path.insert(0, str(QA_ROOT))

from rag.service import RAGService


class DummyRetriever:
    pass


class StructuredStreamingService(RAGService):
    def __init__(self):
        super().__init__(DummyRetriever(), "http://example.com", "test-key", "test-model")

    def _build_prompt(self, question, context, history=None, retrieval_hint=None, source_doc_nums=None, source_doc_required_labels=None):
        return [{"role": "user", "content": question}]

    def _stream_chat_completion(self, messages, *, max_tokens):
        yield "answer", {"content": "原始回答。"}

    def _finalize_answer_and_sources(self, answer, sources, *, question, missing_image_log):
        return "规范后的回答。", sources


class StreamAnswerDocumentTests(unittest.TestCase):
    def test_final_document_replaces_legacy_answer_replacement_event(self):
        events = list(
            StructuredStreamingService().answer_question_stream(
                question="请回答",
                history=[],
                use_retrieval=False,
                top_k=1,
            )
        )

        names = [name for name, _payload in events]
        self.assertIn("answer_document", names)
        self.assertNotIn("answer_replaced", names)
        self.assertLess(names.index("answer_document"), names.index("done"))
        payload = next(payload for name, payload in events if name == "answer_document")
        self.assertEqual("规范后的回答。", payload["sections"][0]["markdown"])
        self.assertEqual([], payload["sources"])


if __name__ == "__main__":
    unittest.main()
