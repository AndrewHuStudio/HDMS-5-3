from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
QA_ROOT = PROJECT_ROOT / "backend" / "qa_assistant"

for candidate in (PROJECT_ROOT, QA_ROOT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from backend.qa_assistant.routes import qa
from data_process.ocr_process import core as ocr_core


def test_ocr_output_root_uses_external_env_file(monkeypatch) -> None:
    project_root = PROJECT_ROOT

    monkeypatch.delenv("OCR_OUTPUT_DIR", raising=False)
    monkeypatch.setattr(ocr_core, "_find_env_file", lambda: project_root / ".env.external")

    resolved = ocr_core._resolve_ocr_output_root()

    assert resolved == (project_root / "data" / "ocr_output_external").resolve()


def test_resolve_image_path_falls_back_to_configured_ocr_output_root(tmp_path, monkeypatch) -> None:
    project_root = tmp_path
    image_path = project_root / "data" / "ocr_output_external" / "示例文档" / "images" / "page-1.png"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"img")

    monkeypatch.setattr(qa, "_find_project_root", lambda: project_root)
    monkeypatch.setattr(qa, "_ocr_output_roots", lambda project_root: [project_root / "data" / "ocr_output_external"])

    resolved = qa._resolve_image_path(
        {
            "file_name": "示例文档.pdf",
            "markdown_path": "",
            "metadata": {},
        },
        "images/page-1.png",
    )

    assert resolved == image_path
