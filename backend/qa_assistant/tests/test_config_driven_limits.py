import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent))

from core import config as app_config
from rag.service import RAGService
from routes import qa as qa_routes
from schemas.rag_schemas import FeedbackRequest, RAGChatMessage, RAGChatRequest


class _RetrieverRecorder:
    def __init__(self):
        self.last_kwargs = None

    def retrieve(self, **kwargs):
        self.last_kwargs = kwargs
        return {
            "vector_results": [],
            "graph_results": [],
            "keyword_results": [],
            "fused_results": [],
        }


class _ServiceRecorder:
    def __init__(self):
        self.history = None

    def answer_question(self, *, question, history, use_retrieval, top_k):
        self.history = history
        return {
            "answer": "ok",
            "model": "test-model",
            "sources": [],
            "context_used": False,
        }


class _MongoRecorder:
    def __init__(self):
        self.inserted = None

    def insert_document(self, collection: str, doc: dict):
        self.inserted = (collection, doc)


def test_answer_question_respects_configured_top_k_cap(monkeypatch):
    retriever = _RetrieverRecorder()
    service = RAGService(
        retriever=retriever,
        llm_base_url="https://example.com/v1",
        llm_api_key="test-key",
        llm_model="deepseek-r1",
    )

    monkeypatch.setattr(app_config, "QUERY_CACHE_ENABLED", False)
    monkeypatch.setattr(app_config, "QA_TOP_K_MAX", 7, raising=False)
    monkeypatch.setattr(service, "_build_context_and_sources", lambda retrieval_results, query: ("", []))
    monkeypatch.setattr(service, "_generate_answer", lambda _messages: "ok")
    monkeypatch.setattr(service, "_finalize_answer_and_sources", lambda answer, sources, **_: (answer, sources))

    service.answer_question(question="top_k test", history=[], use_retrieval=True, top_k=999)

    assert retriever.last_kwargs is not None
    assert retriever.last_kwargs["top_k"] == 7


def test_chat_respects_configured_history_window(monkeypatch):
    service = _ServiceRecorder()

    monkeypatch.setattr(app_config, "QA_HISTORY_WINDOW", 2, raising=False)
    monkeypatch.setattr(qa_routes, "_create_retriever", lambda: object())
    monkeypatch.setattr(qa_routes, "create_rag_service", lambda _retriever: service)

    request = RAGChatRequest(
        question="history test",
        history=[RAGChatMessage(role="user", content=f"msg-{idx}") for idx in range(5)],
        use_retrieval=True,
        top_k=5,
    )

    response = qa_routes.chat(request)

    assert response.answer == "ok"
    assert service.history is not None
    assert len(service.history) == 2
    assert service.history[0]["content"] == "msg-3"


def test_feedback_respects_configured_answer_limit_and_message_id_prefix(monkeypatch):
    mongo = _MongoRecorder()

    monkeypatch.setattr(app_config, "QA_FEEDBACK_ANSWER_MAX_CHARS", 10, raising=False)
    monkeypatch.setattr(app_config, "QA_FEEDBACK_ID_MESSAGE_PREFIX_LEN", 3, raising=False)
    monkeypatch.setattr(qa_routes.db_manager, "_initialized", True)
    monkeypatch.setattr(qa_routes.db_manager, "mongodb", mongo)
    monkeypatch.setattr(qa_routes.time, "time", lambda: 1700000000)

    request = FeedbackRequest(
        message_id="abcdef123456",
        question="q",
        answer="abcdefghijklmnopqrstuvwxyz",
        rating="useful",
        comment=None,
    )

    response = qa_routes.submit_feedback(request)

    assert response.success is True
    assert response.feedback_id == "fb-1700000000-abc"

    assert mongo.inserted is not None
    collection, doc = mongo.inserted
    assert collection == "qa_feedback"
    assert doc["answer"] == "abcdefghij"
