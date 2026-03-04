from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from data_process.ocr_process import core as ocr_core


@pytest.fixture(autouse=True)
def _clean_jobs() -> None:
    with ocr_core._jobs_lock:
        ocr_core._jobs.clear()
    yield
    with ocr_core._jobs_lock:
        ocr_core._jobs.clear()


def _write_pdf(path: Path, content: bytes) -> Path:
    path.write_bytes(content)
    return path


def test_submit_ocr_job_deduplicates_against_existing_hash(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output_root = tmp_path / "ocr_output"
    category = "spec"
    existing_dir = output_root / category / "doc-a"
    existing_dir.mkdir(parents=True)

    content = b"%PDF-1.7 same-content"
    content_hash = hashlib.sha256(content).hexdigest()
    (existing_dir / "doc-a.meta.json").write_text(
        json.dumps({"source_file_hash": content_hash}, ensure_ascii=False),
        encoding="utf-8",
    )

    monkeypatch.setenv("OCR_OUTPUT_DIR", str(output_root))
    upload = _write_pdf(tmp_path / "dup.pdf", content)

    result = ocr_core.submit_ocr_job([upload], ["dup.pdf"], category=category)

    assert result["accepted_count"] == 0
    assert result["deduplicated_count"] == 1
    assert result["deduplicated_files"] == ["dup.pdf"]


def test_submit_ocr_job_deduplicates_duplicate_files_in_same_request(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class _NoopThread:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def start(self) -> None:
            return

    monkeypatch.setattr(ocr_core.threading, "Thread", _NoopThread)
    monkeypatch.setenv("OCR_OUTPUT_DIR", str(tmp_path / "ocr_output"))

    payload = b"%PDF-1.7 duplicated in same request"
    first = _write_pdf(tmp_path / "a.pdf", payload)
    second = _write_pdf(tmp_path / "b.pdf", payload)

    result = ocr_core.submit_ocr_job(
        [first, second],
        ["a.pdf", "b.pdf"],
        category="default",
    )

    assert result["accepted_count"] == 1
    assert result["rejected_count"] == 0
    assert result["deduplicated_count"] == 1
    assert result["deduplicated_files"] == ["b.pdf"]
