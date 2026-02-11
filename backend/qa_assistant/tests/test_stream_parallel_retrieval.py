import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

# Keep imports consistent with existing test scripts.
sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.service import RAGService
import rag.service as service_module
from core import config as app_config


class DummyRetriever:
    def __init__(self, delay_seconds: float = 0.15):
        self.delay_seconds = delay_seconds

    def retrieve(self, **kwargs):
        time.sleep(self.delay_seconds)
        return {
            "vector_results": [
                {
                    "id": "chunk-1",
                    "source": "vector",
                    "text": "????????????????80????",
                    "metadata": {
                        "file_name": "control_doc.md",
                        "section_title": "????",
                    },
                    "score": 0.91,
                }
            ],
            "graph_results": [],
            "keyword_results": [],
            "fused_results": [],
            "reranked": False,
        }

    def _compute_weights(self, query: str):
        return {"vector": 1.0, "graph": 0.0, "keyword": 0.0}


class FakeChunk:
    def __init__(self, content=None, finish_reason=None, reasoning_content=None):
        delta = SimpleNamespace(content=content)
        if reasoning_content is not None:
            delta.reasoning_content = reasoning_content
        choice = SimpleNamespace(delta=delta, finish_reason=finish_reason)
        self.choices = [choice]


class FakeOpenAI:
    scripted_outputs = []
    calls = []

    def __init__(self, *args, **kwargs):
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        FakeOpenAI.calls.append(kwargs)
        idx = len(FakeOpenAI.calls) - 1
        text = FakeOpenAI.scripted_outputs[idx]
        return iter([
            FakeChunk(content=text, finish_reason=None),
            FakeChunk(content=None, finish_reason="stop"),
        ])


@pytest.fixture(autouse=True)
def reset_fake_openai():
    FakeOpenAI.calls = []
    FakeOpenAI.scripted_outputs = [
        "????????",
        "?????????????",
    ]
    yield


def test_stream_starts_answer_before_retrieval_events(monkeypatch):
    monkeypatch.setattr(service_module.openai, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(app_config, "QUERY_CACHE_ENABLED", False)
    monkeypatch.setattr(app_config, "STREAM_RETRIEVAL_MODE", "vector")
    monkeypatch.setattr(app_config, "STREAM_RETRIEVAL_TOP_K_CAP", 8)
    monkeypatch.setattr(app_config, "STREAM_ENABLE_RERANK", True)

    service = RAGService(
        retriever=DummyRetriever(delay_seconds=0.15),
        llm_base_url="https://example.com/v1",
        llm_api_key="test-key",
        llm_model="deepseek-r1",
    )

    events = list(service.answer_question_stream(
        question="???????????????",
        history=[],
        use_retrieval=True,
        top_k=5,
    ))

    first_answer_index = next(i for i, (event, _) in enumerate(events) if event == "answer")
    first_sources_index = next(i for i, (event, _) in enumerate(events) if event == "sources")

    # New UX goal: users see answer tokens immediately, then retrieval data arrives.
    assert first_answer_index < first_sources_index

    # Two-stage generation: prelude + retrieval-grounded continuation.
    assert len(FakeOpenAI.calls) == 2
    second_messages = FakeOpenAI.calls[1]["messages"]
    assert any("????" in msg.get("content", "") for msg in second_messages if msg.get("role") == "user")
