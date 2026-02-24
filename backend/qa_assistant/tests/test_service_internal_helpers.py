import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.service import RAGService


def test_get_quick_reply_handles_greeting_and_identity():
    greeting = RAGService._get_quick_reply("你好")
    identity = RAGService._get_quick_reply("你是谁")
    other = RAGService._get_quick_reply("请解释容积率")

    assert greeting is not None
    assert identity is not None
    assert other is None


def test_apply_citation_remap_updates_only_matching_labels():
    sources = [
        {"citation_label": "1-9", "name": "a"},
        {"citation_label": "2-1", "name": "b"},
    ]

    RAGService._apply_citation_remap_to_sources(sources, {"1-9": "1-1"})

    assert [s["citation_label"] for s in sources] == ["1-1", "2-1"]
