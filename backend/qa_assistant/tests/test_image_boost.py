import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.service import RAGService
import rag.service as service_module


class DummyMongo:
    def __init__(self, docs):
        self._docs = docs

    def find_by_id(self, collection: str, doc_id: str):
        # Not needed for this test.
        return None

    def text_search(self, collection: str, query: str, limit: int = 10, filter_query=None):
        assert collection == "chunks"
        assert filter_query == {"has_image": True}
        # Return the predefined "image chunk" document.
        return self._docs[:limit]


class DummyRetriever:
    def __init__(self, docs):
        self.mongodb = DummyMongo(docs)


def test_build_context_boosts_image_chunks_when_top_results_have_no_images(monkeypatch):
    monkeypatch.setattr(service_module, "_pdf_is_available", lambda _name: True)

    image_chunk_doc = {
        "_id": "doc-1_99",
        "doc_id": "doc-1",
        "chunk_index": 99,
        "text": "图4.6 公共服务设施立体覆盖率示意图\n![](images/fig46.png)",
        "section_title": "4.6 公共服务设施",
        "has_image": True,
        "has_table": False,
        "file_name": "any.pdf",
        "category": "默认",
        "page": 12,
    }

    service = RAGService(
        retriever=DummyRetriever([image_chunk_doc]),
        llm_base_url="https://example.com/v1",
        llm_api_key="test-key",
        llm_model="deepseek-r1",
    )

    # Fused results do not contain any images.
    retrieval_results = {
        "fused_results": [
            {
                "id": "doc-1_1",
                "source": "vector",
                "text": "公共服务设施的立体覆盖率是指……",
                "doc_id": "doc-1",
                "metadata": {"file_name": "any.pdf", "has_image": False},
                "score": 0.9,
            }
        ],
        "vector_results": [],
        "graph_results": [],
        "keyword_results": [],
    }

    _context, sources = service._build_context_and_sources(retrieval_results, query="公共服务设施的立体覆盖率是什么")

    # The boosted image chunk should appear as an extra source with image_urls.
    assert any(s.get("image_urls") for s in sources), "expected at least one source to carry images"


def test_build_context_boosts_when_existing_images_are_irrelevant(monkeypatch):
    monkeypatch.setattr(service_module, "_pdf_is_available", lambda _name: True)

    boosted_image_doc = {
        "_id": "doc-1_99",
        "doc_id": "doc-1",
        "chunk_index": 99,
        "text": "图4.6 公共服务设施立体覆盖率示意图\n![](images/fig46.png)",
        "section_title": "4.6 公共服务设施",
        "has_image": True,
        "has_table": False,
        "file_name": "any.pdf",
        "category": "默认",
        "page": 12,
    }

    service = RAGService(
        retriever=DummyRetriever([boosted_image_doc]),
        llm_base_url="https://example.com/v1",
        llm_api_key="test-key",
        llm_model="deepseek-r1",
    )

    # Top results already contain an image, but it's unrelated to the query.
    retrieval_results = {
        "fused_results": [
            {
                "id": "doc-2_1",
                "source": "vector",
                "text": "图1 交通组织示意图\n![](images/traffic.png)",
                "doc_id": "doc-2",
                "metadata": {"file_name": "any.pdf", "has_image": True},
                "score": 0.9,
            }
        ],
        "vector_results": [],
        "graph_results": [],
        "keyword_results": [],
    }

    _context, sources = service._build_context_and_sources(retrieval_results, query="公共服务设施的立体覆盖率是什么")
    # We should still end up with the boosted relevant image chunk in sources.
    assert any(
        s.get("image_captions") and "立体覆盖率" in "".join(s["image_captions"])
        for s in sources
    )
