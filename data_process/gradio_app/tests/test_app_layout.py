from __future__ import annotations

import re
from pathlib import Path


APP_PATH = Path(__file__).resolve().parents[1] / "app.py"


def _source() -> str:
    return APP_PATH.read_text(encoding="utf-8")


def test_file_upload_has_fixed_height() -> None:
    source = _source()
    pattern = r"files\s*=\s*gr\.File\((?:.|\n)*?height\s*=\s*UPLOAD_LIST_HEIGHT"
    assert re.search(pattern, source), "OCR upload list should have a fixed height"


def test_key_tables_have_fixed_max_height() -> None:
    source = _source()
    table_names = ["progress_table", "summary_table", "doc_table", "ingest_table"]
    for table_name in table_names:
        pattern = rf"{table_name}\s*=\s*gr\.Dataframe\((?:.|\n)*?max_height\s*=\s*TABLE_VIEW_HEIGHT"
        assert re.search(pattern, source), f"{table_name} should share TABLE_VIEW_HEIGHT"


def test_ui_css_declares_scrollable_regions() -> None:
    source = _source()
    assert "APP_CSS" in source
    assert "#ingest-doc-select" in source
    assert "#ocr-root" in source
    assert ".hdms-panel" in source


def test_vector_tab_uses_full_width_layout() -> None:
    source = _source()
    assert "max-width: none;" in source


def test_vector_tab_uses_page_scrollbar_and_fixed_doc_list() -> None:
    source = _source()
    row_pattern = r'with gr\.Row\(.*elem_id="ingest-main-row"'
    assert re.search(row_pattern, source), "Vector tab main row should expose ingest-main-row"
    assert "height=VECTOR_ROW_HEIGHT" not in source
    assert "#ocr-root" in source and "overflow-y: auto;" in source
    assert "#ingest-doc-select .checkboxgroup" in source


def test_vector_columns_do_not_use_inner_scroll_lock() -> None:
    source = _source()
    assert ".hdms-scroll-col" not in source
