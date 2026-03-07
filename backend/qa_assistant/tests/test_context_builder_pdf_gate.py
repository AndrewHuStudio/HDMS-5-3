from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


PROJECT_ROOT = Path(__file__).resolve().parents[3]
QA_ROOT = PROJECT_ROOT / "backend" / "qa_assistant"
if str(QA_ROOT) not in sys.path:
    sys.path.insert(0, str(QA_ROOT))

from core import config as app_config  # noqa: E402
from rag.context_builder import build_context_and_sources  # noqa: E402


def _parse_page_like(_value: object) -> Tuple[Optional[int], Optional[int]]:
    return None, None


def _infer_page_range(_text: str) -> Tuple[Optional[int], Optional[int]]:
    return None, None


def test_keep_document_sources_when_local_pdf_missing_by_default(monkeypatch) -> None:
    """
    Regression guard:
    Missing local PDF should not wipe document sources, otherwise
    frontend citation/image panels disappear entirely.
    """
    monkeypatch.setattr(app_config, "QA_REQUIRE_LOCAL_PDF_FOR_SOURCES", False, raising=False)

    retrieval_results: Dict[str, Any] = {
        "fused_results": [
            {
                "source": "vector",
                "id": "chunk-1",
                "text": "示例正文 ![图示](images/figure-1.png)",
                "metadata": {
                    "file_name": "不存在的来源文档.pdf",
                },
            }
        ]
    }

    context, sources = build_context_and_sources(
        retrieval_results=retrieval_results,
        query="示例问题",
        mongo=None,
        ranked_results_contain_relevant_images=lambda _results, _query: True,
        search_image_chunks_by_text=lambda _query, _limit: [],
        extract_image_refs=lambda _text: ["images/figure-1.png"],
        extract_image_figure_meta=lambda _text: (["图1.1"], ["图1.1 示例图注"]),
        rewrite_image_urls=lambda text, _doc_id: text,
        extract_first_markdown_table=lambda _text: None,
        pdf_is_available=lambda _name: False,
        parse_page_like=_parse_page_like,
        infer_page_range_from_text=_infer_page_range,
    )

    assert "相关文档内容" in context
    assert len(sources) == 1
    assert sources[0]["citation_label"] == "1-1"
    assert sources[0]["image_urls"] == []


def test_default_mode_skips_pdf_availability_probe(monkeypatch) -> None:
    """
    Performance guard:
    When strict PDF gating is disabled, context building should not trigger
    local PDF index probing at all.
    """
    monkeypatch.setattr(app_config, "QA_REQUIRE_LOCAL_PDF_FOR_SOURCES", False, raising=False)

    retrieval_results: Dict[str, Any] = {
        "fused_results": [
            {
                "source": "vector",
                "id": "chunk-1",
                "text": "示例正文",
                "metadata": {"file_name": "任意文档.pdf"},
            }
        ]
    }

    probe_calls = 0

    def _pdf_probe(_name: str) -> bool:
        nonlocal probe_calls
        probe_calls += 1
        return False

    build_context_and_sources(
        retrieval_results=retrieval_results,
        query="示例问题",
        mongo=None,
        ranked_results_contain_relevant_images=lambda _results, _query: True,
        search_image_chunks_by_text=lambda _query, _limit: [],
        extract_image_refs=lambda _text: [],
        extract_image_figure_meta=lambda _text: ([], []),
        rewrite_image_urls=lambda text, _doc_id: text,
        extract_first_markdown_table=lambda _text: None,
        pdf_is_available=_pdf_probe,
        parse_page_like=_parse_page_like,
        infer_page_range_from_text=_infer_page_range,
    )

    assert probe_calls == 0


def test_strict_mode_can_filter_missing_local_pdf(monkeypatch) -> None:
    monkeypatch.setattr(app_config, "QA_REQUIRE_LOCAL_PDF_FOR_SOURCES", True, raising=False)

    retrieval_results: Dict[str, Any] = {
        "fused_results": [
            {
                "source": "vector",
                "id": "chunk-1",
                "text": "示例正文",
                "metadata": {"file_name": "不存在的来源文档.pdf"},
            }
        ]
    }

    context, sources = build_context_and_sources(
        retrieval_results=retrieval_results,
        query="示例问题",
        mongo=None,
        ranked_results_contain_relevant_images=lambda _results, _query: True,
        search_image_chunks_by_text=lambda _query, _limit: [],
        extract_image_refs=lambda _text: [],
        extract_image_figure_meta=lambda _text: ([], []),
        rewrite_image_urls=lambda text, _doc_id: text,
        extract_first_markdown_table=lambda _text: None,
        pdf_is_available=lambda _name: False,
        parse_page_like=_parse_page_like,
        infer_page_range_from_text=_infer_page_range,
    )

    assert context == ""
    assert sources == []
