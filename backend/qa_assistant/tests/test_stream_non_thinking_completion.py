import inspect
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


QA_ROOT = Path(__file__).resolve().parents[1]
if str(QA_ROOT) not in sys.path:
    sys.path.insert(0, str(QA_ROOT))

from rag.service import RAGService


class _DummyRetriever:
    pass


class _FakeCompletions:
    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return iter(
            [
                SimpleNamespace(
                    choices=[
                        SimpleNamespace(
                            delta=SimpleNamespace(
                                reasoning_content=None,
                                content="完整正式答案。",
                            ),
                            finish_reason=None,
                        )
                    ]
                ),
                SimpleNamespace(
                    choices=[
                        SimpleNamespace(
                            delta=SimpleNamespace(
                                reasoning_content=None,
                                content=None,
                            ),
                            finish_reason="stop",
                        )
                    ]
                ),
            ]
        )


class _SequencedCompletions:
    def __init__(self, streams):
        self.streams = list(streams)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return iter(self.streams.pop(0))


def _chunk(content=None, finish_reason=None):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                delta=SimpleNamespace(reasoning_content=None, content=content),
                finish_reason=finish_reason,
            )
        ]
    )


class StreamNonThinkingCompletionTests(unittest.TestCase):
    def test_requests_answer_only_stream_without_application_output_cap(self):
        service = RAGService(
            retriever=_DummyRetriever(),
            llm_base_url="http://example.com",
            llm_api_key="test-key",
            llm_model="test-model",
        )
        method = service._stream_chat_completion

        self.assertNotIn("max_tokens", inspect.signature(method).parameters)

        completions = _FakeCompletions()
        client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
        with patch("rag.service.openai.OpenAI", return_value=client):
            events = list(method([{"role": "user", "content": "请回答"}]))

        self.assertEqual([("answer", {"content": "完整正式答案。"})], events)
        self.assertEqual(1, len(completions.calls))
        request = completions.calls[0]
        self.assertNotIn("max_tokens", request)
        self.assertEqual(
            {"thinking": {"type": "disabled"}},
            request["extra_body"],
        )

    def test_retries_once_when_first_stream_has_no_answer_content(self):
        service = RAGService(
            retriever=_DummyRetriever(),
            llm_base_url="http://example.com",
            llm_api_key="test-key",
            llm_model="test-model",
        )
        completions = _SequencedCompletions(
            [
                [_chunk(content=" \n", finish_reason="stop")],
                [_chunk(content="重试后的正式答案。"), _chunk(finish_reason="stop")],
            ]
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=completions))

        with patch("rag.service.openai.OpenAI", return_value=client):
            events = list(service._stream_chat_completion([{"role": "user", "content": "请回答"}]))

        self.assertEqual([("answer", {"content": "重试后的正式答案。"})], events)
        self.assertEqual(2, len(completions.calls))

    def test_raises_after_retry_also_returns_no_answer_content(self):
        service = RAGService(
            retriever=_DummyRetriever(),
            llm_base_url="http://example.com",
            llm_api_key="test-key",
            llm_model="test-model",
        )
        completions = _SequencedCompletions(
            [
                [_chunk(content=" \n", finish_reason="length")],
                [_chunk(content=None, finish_reason="stop")],
            ]
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=completions))

        with patch("rag.service.openai.OpenAI", return_value=client):
            with self.assertRaisesRegex(RuntimeError, "未返回有效答案"):
                list(service._stream_chat_completion([{"role": "user", "content": "请回答"}]))

        self.assertEqual(2, len(completions.calls))


if __name__ == "__main__":
    unittest.main()
