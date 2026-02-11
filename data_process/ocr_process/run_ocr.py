from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

# Ensure repo root is on sys.path when running as a script.
ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from data_process.ocr_process.mineru_client import MineruClient


def _list_pdfs(input_path: Path) -> list[tuple[Path, str]]:
    if input_path.is_file() and input_path.suffix.lower() == ".pdf":
        return [(input_path, input_path.parent.name or "default")]

    pdfs: list[tuple[Path, str]] = []
    if not input_path.exists():
        return pdfs

    subdirs = [p for p in input_path.iterdir() if p.is_dir()]
    if subdirs:
        for sub in subdirs:
            for pdf in sub.glob("*.pdf"):
                pdfs.append((pdf, sub.name))
    else:
        for pdf in input_path.glob("*.pdf"):
            pdfs.append((pdf, input_path.name or "default"))
    return pdfs


def _load_progress(progress_path: Path) -> dict:
    if not progress_path.exists():
        return {}
    try:
        return json.loads(progress_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_progress(progress_path: Path, data: dict) -> None:
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    progress_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_markdown(markdown: str, target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(markdown or "", encoding="utf-8")


def run_batch(args: argparse.Namespace) -> None:
    input_root = Path(args.input).resolve()
    output_root = Path(args.output).resolve()
    progress_path = Path(args.progress_file).resolve()

    pdfs = _list_pdfs(input_root)
    if not pdfs:
        print(f"[WARN] No PDFs found in {input_root}")
        return

    progress = _load_progress(progress_path)
    client = MineruClient()

    for pdf_path, category in pdfs:
        doc_name = pdf_path.stem
        doc_dir = output_root / category / doc_name
        raw_dir = doc_dir / "mineru_outputs"

        print(f"[OCR] {pdf_path.name} -> {doc_dir}")
        try:
            result = client.parse_pdf(str(pdf_path), output_dir=str(raw_dir))
            md_text = result.get("markdown") or ""
            md_target = doc_dir / f"{doc_name}.md"
            _write_markdown(md_text, md_target)

            if not args.keep_raw and raw_dir.exists():
                shutil.rmtree(raw_dir, ignore_errors=True)

            progress[str(pdf_path)] = {
                "status": "done",
                "updated_at": datetime.now().isoformat(timespec="seconds"),
                "markdown_path": str(md_target),
                "output_dir": str(doc_dir),
            }
        except Exception as exc:
            progress[str(pdf_path)] = {
                "status": "failed",
                "updated_at": datetime.now().isoformat(timespec="seconds"),
                "error": str(exc),
            }
            print(f"[ERROR] {pdf_path.name}: {exc}")
        finally:
            _save_progress(progress_path, progress)


def main() -> None:
    parser = argparse.ArgumentParser(description="HDMS OCR: PDF -> Markdown (MinerU)")
    parser.add_argument(
        "input",
        nargs="?",
        default=os.getenv("OCR_INPUT_DIR", "data/documents"),
        help="PDF file or directory (default: data/documents)",
    )
    parser.add_argument(
        "--output",
        default=os.getenv("OCR_OUTPUT_DIR", "data/ocr"),
        help="Output directory (default: data/ocr)",
    )
    parser.add_argument(
        "--progress-file",
        default=os.getenv("OCR_PROGRESS_FILE", "data/ocr_progress/ocr_progress.json"),
        help="Progress file path",
    )
    parser.add_argument(
        "--keep-raw",
        action="store_true",
        help="Keep raw MinerU outputs (default: delete)",
    )

    args = parser.parse_args()
    run_batch(args)


if __name__ == "__main__":
    main()
