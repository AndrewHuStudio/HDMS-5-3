import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.service import RAGService
from rag.postprocess import answer as pp_answer
from rag.postprocess import citations as pp_citations
from rag.postprocess import sources as pp_sources
from rag.postprocess import summary as pp_summary
from core import config as app_config


def test_normalize_citations_preserves_doc_number_and_sequences_chunk_by_appearance():
    # N is the document index and must be preserved. M is re-numbered per-doc
    # by first appearance order.
    # Use non-sequential doc ids to ensure we do NOT re-number N.
    text = "A[7-3] B[3-9] C[7-7]"
    valid = {"7-3", "3-9", "7-7"}

    out, remap = pp_citations.normalize_citations(text, valid)

    assert out == "A[7-1] B[3-1] C[7-2]"
    assert remap == {"7-3": "7-1", "3-9": "3-1", "7-7": "7-2"}


def test_normalize_citations_collapses_stacked_but_keeps_repeats():
    text = "X[1-2][2-3] Y[1-2] Z[2-3]"
    valid = {"1-2", "2-3"}

    out, _ = pp_citations.normalize_citations(text, valid)

    # Keep cross-document citations in stacked groups. Do NOT de-dupe across the whole
    # answer; repeated references help users trace statements back to sources.
    assert out == "X[1-1][2-1] Y[1-1] Z[2-1]"


def test_normalize_citations_dedupes_per_doc_within_a_stacked_group():
    text = "A[1-9][1-10][2-3]"
    valid = {"1-9", "1-10", "2-3"}

    out, _ = pp_citations.normalize_citations(text, valid)

    # Keep only the first citation per document within the stacked group,
    # but do not drop citations from other documents.
    assert out == "A[1-1][2-1]"


def test_sanitize_answer_removes_section_numbers_and_mixed_citation_tokens():
    text = "段落（2.2）这里有[1-1/3.0.3]和(3.1.4)、（3.0.2第3款）。"

    out, _ = pp_answer.postprocess_answer(text, valid_labels={"1-1"})

    assert "2.2" not in out
    assert "3.1.4" not in out
    assert "3.0.2第3款" not in out
    assert "[1-1/3.0.3]" not in out
    assert "[1-1]" in out


def test_filters_sources_to_referenced_labels():
    sources = [
        {"citation_label": "1-1", "title": "a"},
        {"citation_label": "2-1", "title": "b"},
        {"citation_label": "1", "title": "graph"},
        {"citation_label": "", "title": "empty"},
    ]

    filtered = pp_sources.filter_sources_to_referenced(sources, referenced_labels={"2-1"})

    assert [s.get("citation_label") for s in filtered] == ["2-1", "1"]


def test_filters_can_keep_uncited_document_sources_when_requested():
    sources = [
        {"citation_label": "1-1", "name": "doc-a.pdf"},
        {"citation_label": "2-1", "name": "doc-b.pdf"},
        {"citation_label": "3-1", "name": "doc-c.pdf"},
    ]

    filtered = pp_sources.filter_sources_to_referenced(
        sources,
        referenced_labels={"1-1", "3-1"},
        keep_uncited_document_sources=True,
    )

    assert [s.get("citation_label") for s in filtered] == ["1-1", "2-1", "3-1"]


def test_collect_document_names_dedupes_by_canonical_file_name():
    sources = [
        {"type": "document", "name": "docs/附件2-1规划导则.PDF", "doc_num": 2},
        {"type": "document", "name": "附件2-1规划导则.pdf", "doc_num": 1},
        {"type": "document", "name": "  附件3-1专项说明.pdf  ", "doc_num": 3},
    ]

    names = pp_summary.collect_document_names(sources)

    assert names == ["附件2-1规划导则.pdf", "附件3-1专项说明.pdf"]


def test_inject_summary_document_names_adds_analysis_and_reason_list():
    answer = "## 检索综述\n\n这里是概述。\n\n## 详细解析\n\n正文内容。"
    sources = [
        {
            "type": "document",
            "name": "docs/附件2-1规划导则.PDF",
            "doc_num": 1,
            "chunk_seq": 1,
            "section": "评估流程",
            "page": 7,
            "score": 0.92,
        },
        {
            "type": "document",
            "name": "附件3-1专项说明.pdf",
            "doc_num": 2,
            "chunk_seq": 1,
            "page": 12,
            "score": 0.81,
        },
    ]

    out = pp_summary.inject_summary_document_names(
        answer,
        sources,
        llm_summary_override="两份资料在关键定义与适用边界上形成互补证据。",
    )

    assert "> 检索资料清单与引用分析：" in out
    assert "## 检索综述" in out
    assert "检索资料清单：①*附件2\\-1规划导则*；②*附件3\\-1专项说明*。" in out
    assert "引用定位：①命中章节“评估流程”；定位到第7页；②定位到第12页。" in out
    assert "两份资料在关键定义与适用边界上形成互补证据。" in out
    assert "AI总结：" not in out
    assert "doc-ref-1" not in out
    assert "doc-ref-2" not in out
    assert ".pdf" not in out.lower()
    assert "分析路径" not in out
    assert "相关度" not in out
    assert "多份资料在定义、阈值与适用边界上相互印证" not in out


def test_generate_summary_reasons_with_llm_accepts_plain_text_fallback(monkeypatch):
    monkeypatch.setattr(app_config, "SUMMARY_REASON_LLM_REWRITE", True)
    service = object.__new__(RAGService)
    service._generate_answer = lambda _messages: "AI总结：需交叉核对术语定义与指标阈值，避免单条文误读。"

    out = RAGService._generate_summary_reasons_with_llm(
        service,
        "高密度城市定义是什么？",
        [{"name": "附件1.pdf", "section": "术语", "page": 2}],
    )

    assert out == "需交叉核对术语定义与指标阈值，避免单条文误读。"


def test_inject_summary_document_names_skips_when_summary_already_contains_materials_section():
    answer = "## 检索综述\n\n这里是概述。\n\n- 检索资料清单：`A.pdf`"
    sources = [{"type": "document", "name": "A.pdf", "doc_num": 1}]

    out = pp_summary.inject_summary_document_names(answer, sources)

    assert out == answer
