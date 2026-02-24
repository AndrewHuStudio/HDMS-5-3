import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.postprocess import markdown as pp_markdown


def test_extract_first_markdown_table_returns_block():
    text = "\n".join([
        "一些前言",
        "| 指标 | 值 |",
        "| --- | --- |",
        "| A | 1 |",
        "| B | 2 |",
        "",
        "后续内容",
    ])
    table = pp_markdown.extract_first_markdown_table(text)
    assert table is not None
    assert "| 指标 | 值 |" in table
    assert "| B | 2 |" in table
