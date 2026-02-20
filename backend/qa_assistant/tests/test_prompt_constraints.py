import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.service import RAGService


class DummyRetriever:
    mongodb = None


def test_prompt_prefers_natural_structure_and_keeps_basic_output_safety():
    service = RAGService(
        retriever=DummyRetriever(),
        llm_base_url="https://example.com/v1",
        llm_api_key="test-key",
        llm_model="deepseek-r1",
    )

    messages = service._build_prompt(
        question="test",
        context="",
        history=[],
    )

    system = next((m for m in messages if m.get("role") == "system"), {})
    content = system.get("content", "")

    assert "自然表达" in content
    assert "不要为了凑结构强行分节" in content
    assert "此处应插入" in content
    assert "HTML表格" in content
    assert "每个小节末尾用总结性句子收束" not in content
    assert "回答必须使用Markdown标题层级组织" not in content


def test_prompt_uses_doc_specific_required_labels_when_provided():
    service = RAGService(
        retriever=DummyRetriever(),
        llm_base_url="https://example.com/v1",
        llm_api_key="test-key",
        llm_model="deepseek-r1",
    )

    messages = service._build_prompt(
        question="test",
        context="dummy context",
        history=[],
        source_doc_nums=[1, 2],
        source_doc_required_labels={1: "1-4", 2: "2-3"},
    )
    user = next((m for m in messages if m.get("role") == "user"), {})
    content = user.get("content", "")

    assert "[1-4]" in content
    assert "[2-3]" in content
