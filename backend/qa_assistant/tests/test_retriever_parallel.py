import logging
import sys
import threading
import time
from pathlib import Path

# Keep imports consistent with existing test scripts.
sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.retriever import MultiSourceRetriever


def test_retrieve_runs_vector_and_keyword_in_parallel():
    retriever = MultiSourceRetriever(
        milvus_client=None,
        mongodb_client=None,
        graph_store=None,
        embedder=None,
        reranker=None,
    )

    vector_started = threading.Event()
    keyword_started = threading.Event()
    overlap = {"vector": False, "keyword": False}

    def vector_search(query, top_k):
        vector_started.set()
        overlap["vector"] = keyword_started.wait(0.2)
        return [{"id": "v1", "text": "vector", "score": 1.0, "source": "vector"}]

    def keyword_search(query, top_k):
        keyword_started.set()
        overlap["keyword"] = vector_started.wait(0.2)
        return [{"id": "k1", "text": "keyword", "score": 0.8, "source": "keyword"}]

    retriever._vector_search = vector_search
    retriever._keyword_search = keyword_search

    start = time.perf_counter()
    result = retriever.retrieve(
        query="test",
        top_k=5,
        use_vector=True,
        use_graph=False,
        use_keyword=True,
        enable_rerank=False,
    )
    elapsed = time.perf_counter() - start

    assert overlap["vector"] is True
    assert overlap["keyword"] is True
    assert result["vector_results"]
    assert result["keyword_results"]
    assert elapsed < 0.35


def test_retrieve_logs_branch_timings(caplog):
    retriever = MultiSourceRetriever(
        milvus_client=None,
        mongodb_client=None,
        graph_store=None,
        embedder=None,
        reranker=None,
    )

    retriever._vector_search = lambda query, top_k: [{"id": "v1", "text": "vector", "score": 1.0, "source": "vector"}]
    retriever._keyword_search = lambda query, top_k: [{"id": "k1", "text": "keyword", "score": 0.8, "source": "keyword"}]

    with caplog.at_level(logging.INFO):
        retriever.retrieve(
            query="test",
            top_k=5,
            use_vector=True,
            use_graph=False,
            use_keyword=True,
            enable_rerank=False,
        )

    messages = [record.getMessage() for record in caplog.records]
    assert any("[TIMING] vector_results took" in msg for msg in messages)
    assert any("[TIMING] keyword_results took" in msg for msg in messages)
