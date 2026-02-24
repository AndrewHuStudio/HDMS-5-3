import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from rag import context_builder
from core import config as app_config


def _noop_images(_text):
    return []


def _noop_figures(_text):
    return [], []


def _identity_text(text, _doc_id):
    return text


def _no_table(_text):
    return None


def _pdf_available(_name):
    return True


def _parse_page(_value):
    return None, None


def _infer_page(_text):
    return None, None


def _build_results(text: str):
    return {
        "fused_results": [
            {
                "id": "chunk-1",
                "source": "vector",
                "text": text,
                "metadata": {"file_name": "docA.pdf", "section_title": "sec"},
                "doc_id": "doc-1",
            }
        ],
        "vector_results": [],
        "graph_results": [],
        "keyword_results": [],
    }


def test_context_builder_keeps_full_chunk_when_limit_disabled(monkeypatch):
    text = "X" * 3200
    monkeypatch.setattr(app_config, "QA_CONTEXT_CHUNK_MAX_CHARS", 0)
    monkeypatch.setattr(app_config, "QA_CONTEXT_QUOTE_MAX_CHARS", 0)

    context, sources = context_builder.build_context_and_sources(
        retrieval_results=_build_results(text),
        query="test",
        mongo=None,
        ranked_results_contain_relevant_images=lambda _results, _query: True,
        search_image_chunks_by_text=lambda _query, _limit: [],
        extract_image_refs=_noop_images,
        extract_image_figure_meta=_noop_figures,
        rewrite_image_urls=_identity_text,
        extract_first_markdown_table=_no_table,
        pdf_is_available=_pdf_available,
        parse_page_like=_parse_page,
        infer_page_range_from_text=_infer_page,
    )

    assert text in context
    assert sources[0]["quote"] == text


def test_context_builder_applies_configured_chunk_limit(monkeypatch):
    text = "Y" * 80
    monkeypatch.setattr(app_config, "QA_CONTEXT_CHUNK_MAX_CHARS", 20)
    monkeypatch.setattr(app_config, "QA_CONTEXT_QUOTE_MAX_CHARS", 10)

    context, sources = context_builder.build_context_and_sources(
        retrieval_results=_build_results(text),
        query="test",
        mongo=None,
        ranked_results_contain_relevant_images=lambda _results, _query: True,
        search_image_chunks_by_text=lambda _query, _limit: [],
        extract_image_refs=_noop_images,
        extract_image_figure_meta=_noop_figures,
        rewrite_image_urls=_identity_text,
        extract_first_markdown_table=_no_table,
        pdf_is_available=_pdf_available,
        parse_page_like=_parse_page,
        infer_page_range_from_text=_infer_page,
    )

    assert "Y" * 80 not in context
    assert "Y" * 20 + "..." in context
    assert sources[0]["quote"] == "Y" * 10 + "..."
