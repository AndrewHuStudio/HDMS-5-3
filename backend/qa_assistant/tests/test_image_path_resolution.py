import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent))

from routes import qa as qa_routes


def test_resolve_image_path_handles_relative_markdown_path_against_project_root(tmp_path, monkeypatch):
    project_root = tmp_path
    doc_dir = project_root / "data" / "ocr_output" / "demo" / "sample_doc"
    images_dir = doc_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    image_path = images_dir / "flow.png"
    image_path.write_bytes(b"fake-png")

    # Intentionally use a file_name that does NOT match sample_doc, so fallback
    # scanning by doc_stem will not rescue the lookup.
    document = {
        "file_name": "mismatch_name.pdf",
        "markdown_path": "data/ocr_output/demo/sample_doc/sample_doc.md",
    }

    monkeypatch.setattr(qa_routes, "_find_project_root", lambda: project_root)

    resolved = qa_routes._resolve_image_path(document, "images/flow.png")

    assert resolved == image_path


def test_resolve_image_path_handles_relative_images_dir_against_project_root(tmp_path, monkeypatch):
    project_root = tmp_path
    images_dir = project_root / "data" / "ocr_output" / "demo" / "sample_doc" / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    image_path = images_dir / "diagram 01.png"
    image_path.write_bytes(b"fake-png")

    document = {
        "file_name": "another_mismatch.pdf",
        "images_dir": "data/ocr_output/demo/sample_doc/images",
    }

    monkeypatch.setattr(qa_routes, "_find_project_root", lambda: project_root)

    resolved = qa_routes._resolve_image_path(document, "diagram 01.png")

    assert resolved == image_path
