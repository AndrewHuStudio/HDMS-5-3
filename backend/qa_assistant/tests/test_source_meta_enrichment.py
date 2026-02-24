import sys
from pathlib import Path

import pytest

# Keep imports consistent with existing test scripts.
sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.service import RAGService
import rag.service as service_module


class DummyMongo:
    def __init__(self, chunk_doc):
        self._chunk_doc = chunk_doc

    def find_by_id(self, collection: str, doc_id: str):
        assert collection == "chunks"
        if doc_id == self._chunk_doc.get("_id"):
            return self._chunk_doc
        return None


class DummyRetriever:
    def __init__(self, chunk_doc):
        self.mongodb = DummyMongo(chunk_doc)


def test_sources_are_enriched_with_chunk_page_and_section(monkeypatch):
    # Avoid coupling unit tests to local data/ PDFs.
    monkeypatch.setattr(service_module, "_pdf_is_available", lambda _name: True)

    chunk_doc = {
        "_id": "chunk-1",
        "page": 10,
        "page_end": 11,
        "section_title": "4.1评估要求",
        "has_image": True,
        "has_table": False,
    }

    service = RAGService(
        retriever=DummyRetriever(chunk_doc),
        llm_base_url="https://example.com/v1",
        llm_api_key="test-key",
        llm_model="deepseek-r1",
    )

    context, sources = service._build_context_and_sources({
        "fused_results": [
            {
                "id": "chunk-1",
                "source": "vector",
                "text": "some chunk text",
                "doc_id": "doc-1",
                "metadata": {
                    "file_name": "any.pdf",
                    # page/section intentionally missing here: enrichment should fill them.
                },
                "score": 0.9,
            }
        ],
        "vector_results": [],
        "graph_results": [],
        "keyword_results": [],
    })

    assert context  # context is built
    assert len(sources) == 1
    assert sources[0]["page"] == 10
    assert sources[0]["page_end"] == 11
    assert sources[0]["section"] == "4.1评估要求"


def test_sources_include_image_figure_and_caption_metadata(monkeypatch):
    monkeypatch.setattr(service_module, "_pdf_is_available", lambda _name: True)

    service = RAGService(
        retriever=DummyRetriever({"_id": "chunk-1"}),
        llm_base_url="https://example.com/v1",
        llm_api_key="test-key",
        llm_model="deepseek-r1",
    )

    context, sources = service._build_context_and_sources({
        "fused_results": [
            {
                "id": "chunk-1",
                "source": "vector",
                "text": "图3.0.1 评估流程图\n![流程图](images/flow.png)",
                "doc_id": "doc-1",
                "metadata": {"file_name": "any.pdf"},
                "score": 0.9,
            }
        ],
        "vector_results": [],
        "graph_results": [],
        "keyword_results": [],
    })

    assert len(sources) == 1
    assert sources[0]["image_urls"] == ["/rag/documents/doc-1/image?ref=images/flow.png"]
    assert sources[0]["image_figures"] == ["图3.0.1"]
    assert "图3.0.1 评估流程图" in sources[0]["image_captions"][0]
    assert "本片段包含" in context and "张图片" in context
    assert "图3.0.1" in context


def test_sources_infer_page_from_text_markers_when_missing(monkeypatch):
    monkeypatch.setattr(service_module, "_pdf_is_available", lambda _name: True)

    service = RAGService(
        retriever=DummyRetriever({"_id": "chunk-1"}),
        llm_base_url="https://example.com/v1",
        llm_api_key="test-key",
        llm_model="deepseek-r1",
    )

    # No page/page_end in metadata or chunk_doc; infer from embedded markers.
    text = "<!-- PAGE 2 -->\n标题\n<!-- PAGE 3 -->\n内容"
    _context, sources = service._build_context_and_sources({
        "fused_results": [
            {
                "id": "chunk-1",
                "source": "vector",
                "text": text,
                "doc_id": "doc-1",
                "metadata": {"file_name": "any.pdf"},
                "score": 0.9,
            }
        ],
        "vector_results": [],
        "graph_results": [],
        "keyword_results": [],
    })

    assert len(sources) == 1
    assert sources[0]["page"] == 2
    assert sources[0]["page_end"] == 3


def test_sources_parse_page_strings_like_5_to_7(monkeypatch):
    monkeypatch.setattr(service_module, "_pdf_is_available", lambda _name: True)

    service = RAGService(
        retriever=DummyRetriever({"_id": "chunk-1"}),
        llm_base_url="https://example.com/v1",
        llm_api_key="test-key",
        llm_model="deepseek-r1",
    )

    _context, sources = service._build_context_and_sources({
        "fused_results": [
            {
                "id": "chunk-1",
                "source": "vector",
                "text": "some chunk text",
                "doc_id": "doc-1",
                "metadata": {
                    "file_name": "any.pdf",
                    "page": "第5-7页",
                },
                "score": 0.9,
            }
        ],
        "vector_results": [],
        "graph_results": [],
        "keyword_results": [],
    })

    assert len(sources) == 1
    assert sources[0]["page"] == 5
    assert sources[0]["page_end"] == 7
