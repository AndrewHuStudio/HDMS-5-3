import sys
from pathlib import Path

import pytest

# Keep imports consistent with existing test scripts.
sys.path.insert(0, str(Path(__file__).parent.parent))

from routes import qa as qa_routes


def _write_dummy_pdf(path: Path) -> None:
    # Minimal header so tools/browser won't choke if someone tries to open it.
    path.write_bytes(b"%PDF-1.4\n%HDMS\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n")


def test_resolve_pdf_path_exact_match(monkeypatch, tmp_path: Path):
    # Arrange
    data_dir = tmp_path / "data" / "orginal_input" / "topic"
    data_dir.mkdir(parents=True, exist_ok=True)
    pdf = data_dir / "DU06-03-manual.pdf"
    _write_dummy_pdf(pdf)

    monkeypatch.setattr(qa_routes, "_find_project_root", lambda: tmp_path)

    doc = {
        "file_name": "DU06-03-manual.pdf",
        "markdown_path": str(tmp_path / "data" / "ocr_output" / "x.md"),
        "metadata": {},
    }

    # Act
    resolved = qa_routes._resolve_pdf_path(doc)

    # Assert
    assert resolved is not None
    assert resolved.resolve() == pdf.resolve()


def test_resolve_pdf_path_fuzzy_match_ignores_punctuation(monkeypatch, tmp_path: Path):
    # Arrange: on disk we keep punctuation; in DB we might lose it.
    data_dir = tmp_path / "data" / "orginal_input" / "topic"
    data_dir.mkdir(parents=True, exist_ok=True)
    pdf = data_dir / "DU01-01,DU01-02,DU01-03-manual.pdf"
    _write_dummy_pdf(pdf)

    monkeypatch.setattr(qa_routes, "_find_project_root", lambda: tmp_path)

    doc = {
        # Missing commas/dashes (common OCR/metadata normalization issue)
        "file_name": "DU0101DU0102DU0103manual.pdf",
        "metadata": {},
    }

    # Act
    resolved = qa_routes._resolve_pdf_path(doc)

    # Assert
    assert resolved is not None
    assert resolved.resolve() == pdf.resolve()


def test_resolve_pdf_path_uses_basename_when_file_name_contains_path(monkeypatch, tmp_path: Path):
    data_dir = tmp_path / "data" / "orginal_input"
    data_dir.mkdir(parents=True, exist_ok=True)
    pdf = data_dir / "handbook.pdf"
    _write_dummy_pdf(pdf)

    monkeypatch.setattr(qa_routes, "_find_project_root", lambda: tmp_path)

    doc = {
        "file_name": r"some\nested\handbook.pdf",
        "metadata": {},
    }

    resolved = qa_routes._resolve_pdf_path(doc)
    assert resolved is not None
    assert resolved.resolve() == pdf.resolve()


def test_resolve_pdf_path_can_derive_from_markdown_stem(monkeypatch, tmp_path: Path):
    data_dir = tmp_path / "data" / "orginal_input"
    data_dir.mkdir(parents=True, exist_ok=True)
    pdf = data_dir / "from_markdown.pdf"
    _write_dummy_pdf(pdf)

    monkeypatch.setattr(qa_routes, "_find_project_root", lambda: tmp_path)

    doc = {
        "file_name": "from_markdown.md",
        "markdown_path": str(tmp_path / "data" / "ocr_output" / "from_markdown.md"),
        "metadata": {},
    }

    resolved = qa_routes._resolve_pdf_path(doc)
    assert resolved is not None
    assert resolved.resolve() == pdf.resolve()

