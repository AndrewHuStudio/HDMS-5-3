from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
QA_ROOT = PROJECT_ROOT / "backend" / "qa_assistant"
if str(QA_ROOT) not in sys.path:
    sys.path.insert(0, str(QA_ROOT))

from rag.postprocess.citations import normalize_citations  # noqa: E402


def test_parenthesized_label_is_normalized_to_citation_marker() -> None:
    text = "动态监测评估路径（2-3）"
    processed, remap = normalize_citations(text, {"2-3"})

    assert "[2-1]" in processed
    assert remap == {"2-3": "2-1"}


def test_standalone_label_is_normalized_to_citation_marker() -> None:
    text = "动态监测评估路径 2-3 。"
    processed, remap = normalize_citations(text, {"2-3"})

    assert "[2-1]" in processed
    assert remap == {"2-3": "2-1"}


def test_numeric_range_text_is_not_treated_as_citation() -> None:
    text = "容积率2-3之间的转移策略需结合片区条件。"
    processed, remap = normalize_citations(text, {"2-3"})

    assert "[2-1]" not in processed
    assert remap == {}
