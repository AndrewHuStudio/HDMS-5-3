
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any, Iterable

import gradio as gr

# Ensure repo root is on sys.path when running as a script.
ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from data_process.ocr_process import core
from data_process.core import config

STATUS_LABELS = {
    "queued": "\u6392\u961f\u4e2d",
    "requesting": "\u8bf7\u6c42\u4e2d",
    "uploading": "\u4e0a\u4f20\u4e2d",
    "processing": "\u8bc6\u522b\u4e2d",
    "downloading": "\u4e0b\u8f7d\u7ed3\u679c",
    "done": "\u5b8c\u6210",
    "failed": "\u5931\u8d25",
}

INGEST_MARKER_NAME = ".vectorized.json"
ALL_CATEGORIES_LABEL = "(\u5168\u90e8)"
ROOT_CATEGORY_LABEL = "(\u6839\u76ee\u5f55)"
FILTER_ALL_LABEL = "\u5168\u90e8"
FILTER_PENDING_LABEL = "\u672a\u5b8c\u6210\u5411\u91cf\u5316"
FILTER_DONE_LABEL = "\u5df2\u5b8c\u6210\u5411\u91cf\u5316"


def _default_ocr_output_dir() -> str:
    try:
        data = core.get_destinations()
    except core.OCRError:
        return str(ROOT_DIR / "data" / "ocr_output")
    return data.get("root") or str(ROOT_DIR / "data" / "ocr_output")


def _resolve_output_dir(value: str) -> Path:
    raw_dir = (value or "").strip()
    if not raw_dir:
        raw_dir = _default_ocr_output_dir()
    return Path(raw_dir).resolve()


def _marker_path(doc_dir: Path) -> Path:
    return doc_dir / INGEST_MARKER_NAME


def _read_marker(doc_dir: Path) -> dict[str, Any] | None:
    marker = _marker_path(doc_dir)
    if not marker.exists():
        return None
    try:
        return json.loads(marker.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_marker(doc_dir: Path, payload: dict[str, Any]) -> None:
    marker = _marker_path(doc_dir)
    try:
        marker.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def _is_doc_dir(path: Path) -> bool:
    if not path.is_dir():
        return False
    md_files = [p for p in path.glob("*.md") if not p.name.endswith(".meta.md")]
    meta_files = list(path.glob("*.meta.json"))
    return bool(md_files and meta_files)


def _normalize_category(value: str) -> str:
    raw = (value or "").strip()
    if not raw or raw == ALL_CATEGORIES_LABEL:
        return ""
    return raw


def _scan_categories(output_path: Path) -> tuple[list[str], list[Path]]:
    category_dirs: list[Path] = []
    root_doc_dirs: list[Path] = []
    if not output_path.exists():
        return [], []
    for child in output_path.iterdir():
        if not child.is_dir():
            continue
        if _is_doc_dir(child):
            root_doc_dirs.append(child)
        else:
            category_dirs.append(child)
    categories = sorted([d.name for d in category_dirs], key=lambda s: s.lower())
    if root_doc_dirs:
        categories.insert(0, ROOT_CATEGORY_LABEL)
    return categories, root_doc_dirs


def _load_documents(ocr_output_dir: str, category: str) -> tuple[list[dict[str, Any]], list[str], str]:
    raw_dir = (ocr_output_dir or "").strip()
    if not raw_dir:
        raw_dir = _default_ocr_output_dir()
    output_path = Path(raw_dir).resolve()
    if not output_path.exists():
        return [], [], f"[FAIL] OCR \u8f93\u51fa\u76ee\u5f55\u4e0d\u5b58\u5728: {output_path}"

    categories, root_doc_dirs = _scan_categories(output_path)
    category = _normalize_category(category)

    doc_dirs: list[Path] = []
    if category:
        if category == ROOT_CATEGORY_LABEL:
            doc_dirs = root_doc_dirs
        else:
            cat_dir = output_path / category
            if not cat_dir.exists():
                return [], categories, f"[FAIL] \u5206\u7c7b\u76ee\u5f55\u4e0d\u5b58\u5728: {cat_dir}"
            doc_dirs = [p for p in cat_dir.iterdir() if p.is_dir()]
    else:
        doc_dirs.extend(root_doc_dirs)
        for cat_name in categories:
            if cat_name == ROOT_CATEGORY_LABEL:
                continue
            cat_dir = output_path / cat_name
            if cat_dir.exists():
                doc_dirs.extend([p for p in cat_dir.iterdir() if p.is_dir()])

    doc_dirs = sorted(doc_dirs, key=lambda p: p.name.lower())
    if not doc_dirs:
        return [], categories, f"[WARN] \u672a\u627e\u5230\u53ef\u5165\u5e93\u7684\u6587\u6863: {output_path}"

    db_docs_by_path: dict[str, dict[str, Any]] = {}
    try:
        modules = _get_rhino_modules()
        db_manager = modules["db_manager"]
        if db_manager._initialized:
            md_paths: list[str] = []
            for doc_dir in doc_dirs:
                if not doc_dir.is_dir():
                    continue
                md_files = [p for p in doc_dir.glob("*.md") if not p.name.endswith(".meta.md")]
                if md_files:
                    md_paths.append(str(md_files[0]))
            if md_paths:
                db_docs = db_manager.mongodb.find_by_query(
                    "documents",
                    {"markdown_path": {"$in": md_paths}},
                    limit=max(len(md_paths), 1),
                    projection={
                        "_id": 1,
                        "markdown_path": 1,
                        "ingest_status": 1,
                        "ingested_at": 1,
                        "ingest_error": 1,
                        "file_name": 1,
                        "chunks_count": 1,
                        "images_processed": 1,
                    },
                )
                db_docs_by_path = {
                    doc.get("markdown_path"): doc for doc in db_docs if doc.get("markdown_path")
                }
    except Exception:
        db_docs_by_path = {}

    items: list[dict[str, Any]] = []
    for doc_dir in doc_dirs:
        md_files = [p for p in doc_dir.glob("*.md") if not p.name.endswith(".meta.md")]
        meta_files = list(doc_dir.glob("*.meta.json"))
        category_name = ROOT_CATEGORY_LABEL if doc_dir.parent == output_path else doc_dir.parent.name
        key = f"{category_name}/{doc_dir.name}"
        marker = _read_marker(doc_dir)
        markdown_path = str(md_files[0]) if md_files else ""
        db_doc = db_docs_by_path.get(markdown_path) if markdown_path else None
        db_status = (db_doc or {}).get("ingest_status") or ""
        db_ingested = db_status == "complete"
        ingested = db_ingested or (bool(marker) and not db_doc)
        ingested_at = (db_doc or {}).get("ingested_at") or (marker or {}).get("ingested_at", "")
        doc_id = (db_doc or {}).get("_id") or (marker or {}).get("doc_id", "")
        chunks_count = int(
            (db_doc or {}).get("chunks_count")
            or (marker or {}).get("chunks_count")
            or 0
        )
        source_images = 0
        images_dir_path = doc_dir / "images"
        if images_dir_path.exists() and images_dir_path.is_dir():
            try:
                source_images = len([p for p in images_dir_path.iterdir() if p.is_file()])
            except Exception:
                source_images = 0
        images_count = int(
            (db_doc or {}).get("images_processed")
            or (marker or {}).get("images_processed")
            or source_images
            or 0
        )
        ingest_error = (db_doc or {}).get("ingest_error") or ""
        items.append(
            {
                "key": key,
                "name": doc_dir.name,
                "category": category_name,
                "doc_dir": doc_dir,
                "markdown_path": markdown_path,
                "meta_path": str(meta_files[0]) if meta_files else "",
                "images_dir": str(doc_dir / "images") if (doc_dir / "images").exists() else None,
                "ready": bool(md_files and meta_files),
                "ingested": ingested,
                "ingested_at": ingested_at,
                "ingest_status": db_status,
                "doc_id": str(doc_id) if doc_id else "",
                "chunks_count": chunks_count,
                "images_count": images_count,
                "error": (
                    ingest_error
                    if ingest_error
                    else ("" if (md_files and meta_files) else "\u7f3a\u5c11 .md \u6216 .meta.json")
                ),
            }
        )

    return items, categories, f"[INFO] \u53d1\u73b0 {len(items)} \u4e2a\u6587\u6863"


def _build_doc_table(items: list[dict[str, Any]]) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for item in items:
        if item.get("ingested"):
            status = "\u5df2\u5165\u5e93"
        else:
            ingest_status = item.get("ingest_status")
            if ingest_status == "in_progress":
                status = "\u5904\u7406\u4e2d"
            elif ingest_status == "failed":
                status = "\u5931\u8d25"
            elif item.get("ready"):
                status = "\u672a\u5165\u5e93"
            else:
                status = "\u7f3a\u5931\u6587\u4ef6"
        rows.append(
            [
                status,
                item.get("name", ""),
                item.get("category", ""),
                int(item.get("chunks_count") or 0),
                int(item.get("images_count") or 0),
                item.get("ingested_at", ""),
                item.get("error", ""),
            ]
        )
    return rows


def _apply_status_filter(items: list[dict[str, Any]], status_filter: str) -> list[dict[str, Any]]:
    if status_filter == FILTER_DONE_LABEL:
        return [item for item in items if item.get("ingested")]
    if status_filter == FILTER_PENDING_LABEL:
        return [item for item in items if not item.get("ingested")]
    return list(items)


def _apply_category_filter(items: list[dict[str, Any]], category: str) -> list[dict[str, Any]]:
    category_value = _normalize_category(category)
    if not category_value:
        return list(items)
    if category_value == ROOT_CATEGORY_LABEL:
        return [item for item in items if item.get("category") == ROOT_CATEGORY_LABEL]
    return [item for item in items if item.get("category") == category_value]


def _ingest_overview_text(items: list[dict[str, Any]]) -> str:
    total = len(items)
    done = sum(1 for item in items if item.get("ingested"))
    percent = int(round(done / total * 100)) if total else 0
    chunks = sum(int(item.get("chunks_count") or 0) for item in items if item.get("ingested"))
    return f"[INFO] \u5b8c\u6210 {done}/{total} ({percent}%) | Chunk \u603b\u6570: {chunks}"


def _build_select_choices(items: list[dict[str, Any]]) -> list[str]:
    # CheckboxGroup uses value equality to manage checked state; dedupe keys to avoid collisions.
    seen: set[str] = set()
    choices: list[str] = []
    for item in items:
        if not item.get("ready") or item.get("ingested"):
            continue
        key = str(item.get("key") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        choices.append(key)
    return choices




def _format_summary(summary: dict[str, Any]) -> str:
    total_files = int(summary.get("total_files") or 0)
    total_pages = int(summary.get("total_pages") or 0)
    total_images = int(summary.get("total_images") or 0)
    categories = summary.get("categories") or []
    refreshed_at = time.strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        f"\u603b\u6587\u4ef6\u6570: {total_files}",
        f"\u603b\u9875\u6570: {total_pages}",
        f"\u603b\u56fe\u7247\u6570: {total_images}",
        f"\u5206\u7c7b\u6570: {len(categories)}",
        f"\u5237\u65b0\u65f6\u95f4: {refreshed_at}",
    ]
    return "\n".join(lines)


def _summary_table(summary: dict[str, Any]) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for item in summary.get("categories") or []:
        rows.append(
            [
                item.get("category") or "",
                int(item.get("total_files") or 0),
                int(item.get("total_pages") or 0),
                int(item.get("total_images") or 0),
            ]
        )
    return rows


def _safe_summary() -> tuple[str, list[list[Any]]]:
    try:
        summary = core.get_summary()
    except core.OCRError as exc:
        return f"[FAIL] {exc.message}", []
    return _format_summary(summary), _summary_table(summary)


def _destinations_update(set_value: bool) -> tuple[Any, str]:
    try:
        data = core.get_destinations()
    except core.OCRError as exc:
        return gr.update(choices=[]), f"[FAIL] {exc.message}"
    destinations = data.get("destinations") or []
    if set_value:
        update = gr.update(choices=destinations, value=destinations[0] if destinations else "")
    else:
        update = gr.update(choices=destinations)
    return update, f"[INFO] \u8f93\u51fa\u76ee\u5f55: {data.get('root')}"


def _build_progress(job: dict[str, Any] | None, job_id: str | None) -> tuple[str, list[list[Any]], bool]:
    if not job:
        return "[INFO] \u6682\u65e0\u4efb\u52a1", [], True

    files = job.get("files") or []
    total = len(files)
    done_count = 0
    failed_count = 0
    rows: list[list[Any]] = []

    for item in files:
        status = str(item.get("status") or "")
        status_label = STATUS_LABELS.get(status, status or "unknown")
        progress = int(item.get("progress") or 0)
        pages = item.get("pages") or item.get("total_pages") or 0
        error = item.get("error") or ""
        if status in {"done", "failed"}:
            done_count += 1
        if status == "failed":
            failed_count += 1
        rows.append(
            [
                item.get("file_name") or "",
                status_label,
                f"{progress}%",
                int(pages or 0),
                error,
            ]
        )

    pending = total - done_count
    job_prefix = job_id[:8] if job_id else ""
    summary = (
        f"[INFO] \u4efb\u52a1 {job_prefix} | \u603b\u6570 {total} | "
        f"\u5b8c\u6210 {done_count} | \u5931\u8d25 {failed_count} | \u8fdb\u884c\u4e2d {pending}"
    )
    is_done = total > 0 and done_count == total
    return summary, rows, is_done


def _init_ui() -> tuple[Any, str, str, list[list[Any]]]:
    dest_update, status_text = _destinations_update(set_value=True)
    summary_text = "[INFO] \u70b9\u51fb\u5237\u65b0\u83b7\u53d6\u7edf\u8ba1"
    return dest_update, status_text, summary_text, []


def _refresh_destinations() -> tuple[Any, str]:
    return _destinations_update(set_value=False)


def _refresh_summary() -> tuple[str, list[list[Any]]]:
    return _safe_summary()


def _clear_outputs() -> tuple[str, str, list[list[Any]], Any]:
    try:
        result = core.clear_output_dir()
        status = f"[OK] \u5df2\u6e05\u7a7a\u8f93\u51fa\u76ee\u5f55: \u5220\u9664 {result.get('deleted', 0)} \u9879"
    except core.OCRError as exc:
        status = f"[FAIL] {exc.message}"
    dest_update, _ = _destinations_update(set_value=True)
    summary_text, summary_rows = _safe_summary()
    return status, summary_text, summary_rows, dest_update


def _submit(files: list[str] | None, category: str) -> tuple[str, str, str, list[list[Any]], str, list[list[Any]], Any]:
    if not files:
        summary_text, summary_rows = _safe_summary()
        return (
            "",
            "[WARN] \u8bf7\u5148\u9009\u62e9 PDF \u6587\u4ef6",
            "[INFO] \u7b49\u5f85\u4efb\u52a1",
            [],
            summary_text,
            summary_rows,
            gr.update(active=False),
        )

    file_paths = [Path(p) for p in files]
    original_names = [Path(p).name for p in files]

    try:
        result = core.submit_ocr_job(file_paths, original_names, category or "")
    except core.OCRError as exc:
        summary_text, summary_rows = _safe_summary()
        return (
            "",
            f"[FAIL] {exc.message}",
            "[INFO] \u4efb\u52a1\u672a\u542f\u52a8",
            [],
            summary_text,
            summary_rows,
            gr.update(active=False),
        )

    job_id = result.get("job_id") or ""
    accepted = result.get("accepted_count", 0)
    rejected = result.get("rejected_count", 0)
    rejected_files = result.get("rejected_files") or []
    status_lines = [
        f"[OK] \u5df2\u63d0\u4ea4\u4efb\u52a1: {job_id}",
        f"\u63a5\u53d7: {accepted}",
        f"\u62d2\u7edd: {rejected}",
    ]
    if rejected_files:
        status_lines.append("\u62d2\u7edd\u6587\u4ef6: " + ", ".join(str(x) for x in rejected_files))

    job = core.get_job_status(job_id)
    progress_text, progress_rows, done = _build_progress(job, job_id)
    summary_text, summary_rows = _safe_summary()
    return (
        job_id,
        "\n".join(status_lines),
        progress_text,
        progress_rows,
        summary_text,
        summary_rows,
        gr.update(active=not done),
    )


def _poll(job_id: str) -> tuple[str, list[list[Any]], str, list[list[Any]], Any]:
    if not job_id:
        summary_text, summary_rows = _safe_summary()
        return "[INFO] \u6682\u65e0\u4efb\u52a1", [], summary_text, summary_rows, gr.update(active=False)

    job = core.get_job_status(job_id)
    if not job:
        summary_text, summary_rows = _safe_summary()
        return "[WARN] \u4efb\u52a1\u4e0d\u5b58\u5728", [], summary_text, summary_rows, gr.update(active=False)

    progress_text, progress_rows, done = _build_progress(job, job_id)
    summary_text, summary_rows = _safe_summary()
    return progress_text, progress_rows, summary_text, summary_rows, gr.update(active=not done)

_RHINO_MODULES: dict[str, Any] | None = None


def _get_rhino_modules() -> dict[str, Any]:
    global _RHINO_MODULES
    if _RHINO_MODULES is not None:
        return _RHINO_MODULES
    try:
        from data_process.core.database.manager import db_manager
        from data_process.vector_process.ingestion.chunker import DocumentChunker
        from data_process.vector_process.ingestion.embedder import create_embedding_service
        from data_process.vector_process.ingestion.pipeline import IngestionPipeline
        from data_process.vector_process.vision_service import create_vision_service
    except Exception as exc:
        raise RuntimeError(f"\u52a0\u8f7d data_process \u5931\u8d25: {exc}") from exc

    _RHINO_MODULES = {
        "db_manager": db_manager,
        "DocumentChunker": DocumentChunker,
        "create_embedding_service": create_embedding_service,
        "create_vision_service": create_vision_service,
        "IngestionPipeline": IngestionPipeline,
    }
    return _RHINO_MODULES


def _ensure_db_initialized():
    modules = _get_rhino_modules()
    db_manager = modules["db_manager"]
    if not db_manager._initialized:
        db_manager.initialize()
    return db_manager


def _remove_marker_file(doc_dir: Path) -> bool:
    marker = _marker_path(doc_dir)
    if not marker.exists():
        return False
    try:
        marker.unlink()
        return True
    except Exception:
        return False


def _remove_markers_in_dir(root: Path) -> int:
    if not root.exists():
        return 0
    removed = 0
    for marker in root.rglob(INGEST_MARKER_NAME):
        try:
            marker.unlink()
            removed += 1
        except Exception:
            continue
    return removed


def _db_status_text() -> str:
    try:
        modules = _get_rhino_modules()
        db_manager = modules["db_manager"]
        if not db_manager._initialized:
            return "[WARN] \u6570\u636e\u5e93\u672a\u521d\u59cb\u5316"
        stats = db_manager.get_stats()
    except Exception as exc:
        return f"[FAIL] \u83b7\u53d6\u6570\u636e\u5e93\u72b6\u6001\u5931\u8d25: {exc}"

    lines = ["[INFO] Milvus/MongoDB \u7edf\u8ba1"]

    milvus = stats.get("milvus", {})
    if "error" in milvus:
        lines.append(f"Milvus: [FAIL] {milvus['error']}")
    else:
        if milvus.get("exists"):
            dim = milvus.get("dimension")
            dim_text = f", dim {dim}" if dim else ""
            lines.append(f"Milvus: {milvus.get('num_entities', 0)} vectors{dim_text}")
        else:
            lines.append("Milvus: 0 vectors (collection missing)")

    mongodb = stats.get("mongodb", {})
    if "error" in mongodb:
        lines.append(f"MongoDB: [FAIL] {mongodb['error']}")
    else:
        lines.append(f"MongoDB: documents {mongodb.get('documents', 0)}, chunks {mongodb.get('chunks', 0)}")

    return "\n".join(lines)


def _run_ingest_acceptance_check() -> str:
    """One-click acceptance check for Mongo/Milvus consistency."""
    try:
        db_manager = _ensure_db_initialized()
        stats = db_manager.get_stats()

        milvus = stats.get("milvus", {})
        mongo = stats.get("mongodb", {})

        if "error" in milvus:
            return f"[FAIL] Milvus \u72b6\u6001\u83b7\u53d6\u5931\u8d25: {milvus['error']}"
        if "error" in mongo:
            return f"[FAIL] MongoDB \u72b6\u6001\u83b7\u53d6\u5931\u8d25: {mongo['error']}"

        milvus_vectors = int(milvus.get("num_entities", 0) if milvus.get("exists") else 0)
        mongo_docs = int(mongo.get("documents", 0) or 0)
        mongo_chunks = int(mongo.get("chunks", 0) or 0)

        complete_docs = db_manager.mongodb.find_by_query(
            "documents",
            {"ingest_status": "complete"},
            limit=None,
            projection={"_id": 1, "chunks_count": 1},
        )
        expected_chunks = sum(int(doc.get("chunks_count") or 0) for doc in complete_docs)

        vectors_match_chunks = milvus_vectors == mongo_chunks
        chunk_summary_match = mongo_chunks == expected_chunks
        passed = vectors_match_chunks and chunk_summary_match

        check_vectors = "\u901a\u8fc7" if vectors_match_chunks else "\u5931\u8d25"
        check_summary = "\u901a\u8fc7" if chunk_summary_match else "\u5931\u8d25"

        lines = [
            "[OK] \u9a8c\u6536\u901a\u8fc7" if passed else "[WARN] \u9a8c\u6536\u672a\u901a\u8fc7",
            f"Mongo \u6587\u6863\u6570: {mongo_docs}",
            f"Mongo Chunk \u6570: {mongo_chunks}",
            f"Milvus \u5411\u91cf\u6570: {milvus_vectors}",
            f"documents.chunks_count \u6c47\u603b: {expected_chunks}",
            "",
            "\u4e00\u81f4\u6027\u68c0\u67e5:",
            f"- {check_vectors}: Milvus \u5411\u91cf\u6570 == Mongo Chunk \u6570",
            f"- {check_summary}: Mongo Chunk \u6570 == documents.chunks_count \u6c47\u603b",
        ]

        if not passed:
            lines.append("\u5efa\u8bae: \u8bf7\u6267\u884c\u6e05\u7406/\u4fee\u590d\u540e\u91cd\u8bd5\u5165\u5e93\u3002")

        return "\n".join(lines)

    except Exception as exc:
        return f"[FAIL] \u9a8c\u6536\u6267\u884c\u5931\u8d25: {exc}"


def _db_category_choices() -> list[str]:
    try:
        modules = _get_rhino_modules()
        db_manager = modules["db_manager"]
        if not db_manager._initialized:
            return [ALL_CATEGORIES_LABEL]
        docs = db_manager.mongodb.find_by_query(
            "documents",
            {"ingest_status": "complete"},
            limit=5000,
            projection={"category": 1},
        )
    except Exception:
        return [ALL_CATEGORIES_LABEL]

    categories: set[str] = set()
    for doc in docs:
        raw = (doc.get("category") or "").strip()
        if raw:
            categories.add(raw)
        else:
            categories.add(ROOT_CATEGORY_LABEL)
    if not categories:
        return [ALL_CATEGORIES_LABEL]
    return [ALL_CATEGORIES_LABEL] + sorted(categories, key=lambda s: s.lower())


def _db_category_update(current: str | None = None) -> Any:
    choices = _db_category_choices()
    if current in choices:
        value = current
    elif len(choices) > 1:
        value = choices[1]
    else:
        value = choices[0] if choices else ""
    return gr.update(choices=choices, value=value)


def _init_db_ui(current_category: str | None = None) -> tuple[str, str, Any]:
    try:
        modules = _get_rhino_modules()
        db_manager = modules["db_manager"]
        if not db_manager._initialized:
            db_manager.initialize()
        status = "[OK] Milvus \u6570\u636e\u5e93\u8fde\u63a5\u5df2\u521d\u59cb\u5316"
        return status, _db_status_text(), _db_category_update(current_category)
    except Exception as exc:
        status = f"[FAIL] \u6570\u636e\u5e93\u521d\u59cb\u5316\u5931\u8d25: {exc}"
        return status, status, _db_category_update(current_category)


def _refresh_db_ui(current_category: str | None = None) -> tuple[str, str, Any]:
    return "[INFO] \u5df2\u5237\u65b0", _db_status_text(), _db_category_update(current_category)


def _clear_vectors_all(
    ocr_output_dir: str,
    category: str,
    status_filter: str,
    selected_keys: list[str] | None,
    items: list[dict[str, Any]] | None
) -> tuple[str, str, Any, Any, list[list[Any]], str, list[dict[str, Any]]]:
    try:
        db_manager = _ensure_db_initialized()
    except Exception as exc:
        msg = f"[FAIL] \u6570\u636e\u5e93\u521d\u59cb\u5316\u5931\u8d25: {exc}"
        cat_update, select_update, doc_rows, overview_text, _, new_items = _refresh_ingest_list(
            ocr_output_dir, category, status_filter, []
        )
        return msg, msg, cat_update, select_update, doc_rows, overview_text, new_items

    output_path = _resolve_output_dir(ocr_output_dir)
    milvus_msg = ""
    try:
        db_manager.milvus.delete_collection(config.MILVUS_COLLECTION_TEXT)
        db_manager.milvus.create_collection(
            collection_name=config.MILVUS_COLLECTION_TEXT,
            dimension=config.EMBEDDING_DIMENSION,
            recreate_on_mismatch=False,
            strict=False,
        )
        milvus_msg = "Milvus \u5df2\u91cd\u5efa"
    except Exception as exc:
        milvus_msg = f"Milvus \u6e05\u7406\u5931\u8d25: {exc}"

    deleted_chunks = db_manager.mongodb.delete_many("chunks", {})
    deleted_docs = db_manager.mongodb.delete_many("documents", {})
    removed_markers = _remove_markers_in_dir(output_path)

    status = (
        f"[OK] \u5df2\u6e05\u7a7a\u5411\u91cf\u5e93: "
        f"documents {deleted_docs}, chunks {deleted_chunks}, markers {removed_markers}. {milvus_msg}"
    )
    cat_update, select_update, doc_rows, overview_text, _, new_items = _refresh_ingest_list(
        str(output_path), category, status_filter, []
    )
    return status, _db_status_text(), cat_update, select_update, doc_rows, overview_text, new_items


def _clear_vectors_by_category(
    ocr_output_dir: str,
    db_category: str,
    ingest_category: str,
    status_filter: str,
    selected_keys: list[str] | None,
    items: list[dict[str, Any]] | None
) -> tuple[str, str, Any, Any, list[list[Any]], str, list[dict[str, Any]]]:
    if db_category == ALL_CATEGORIES_LABEL:
        return _clear_vectors_all(ocr_output_dir, ingest_category, status_filter, selected_keys, items)

    try:
        db_manager = _ensure_db_initialized()
    except Exception as exc:
        msg = f"[FAIL] \u6570\u636e\u5e93\u521d\u59cb\u5316\u5931\u8d25: {exc}"
        cat_update, select_update, doc_rows, overview_text, _, new_items = _refresh_ingest_list(
            ocr_output_dir, ingest_category, status_filter, []
        )
        return msg, msg, cat_update, select_update, doc_rows, overview_text, new_items

    output_path = _resolve_output_dir(ocr_output_dir)
    category_value = _normalize_category(db_category)
    if category_value == ROOT_CATEGORY_LABEL:
        category_key = ""
        doc_dirs = [p for p in output_path.iterdir() if p.is_dir() and _is_doc_dir(p)]
    else:
        category_key = category_value
        cat_dir = output_path / category_value
        if not cat_dir.exists() or not cat_dir.is_dir():
            msg = f"[WARN] \u5206\u7c7b\u76ee\u5f55\u4e0d\u5b58\u5728: {cat_dir}"
            cat_update, select_update, doc_rows, overview_text, _, new_items = _refresh_ingest_list(
                str(output_path), ingest_category, status_filter, []
            )
            return msg, _db_status_text(), cat_update, select_update, doc_rows, overview_text, new_items
        doc_dirs = [p for p in cat_dir.iterdir() if p.is_dir()]

    docs = db_manager.mongodb.find_by_query(
        "documents",
        {"category": category_key},
        limit=5000,
        projection={"_id": 1},
    )
    doc_ids = [str(doc.get("_id")) for doc in docs if doc.get("_id")]
    deleted_vectors = 0
    if doc_ids:
        try:
            deleted_vectors = db_manager.milvus.delete_by_doc_ids(
                config.MILVUS_COLLECTION_TEXT, doc_ids
            )
        except Exception:
            deleted_vectors = 0

    deleted_chunks = (
        db_manager.mongodb.delete_many("chunks", {"doc_id": {"$in": doc_ids}})
        if doc_ids
        else 0
    )
    deleted_docs = (
        db_manager.mongodb.delete_many("documents", {"_id": {"$in": doc_ids}})
        if doc_ids
        else 0
    )

    removed_markers = 0
    for doc_dir in doc_dirs:
        if _remove_marker_file(doc_dir):
            removed_markers += 1

    label = db_category if db_category else ROOT_CATEGORY_LABEL
    status = (
        f"[OK] \u5df2\u6e05\u7a7a\u5206\u7c7b\u5411\u91cf: {label} | "
        f"docs {deleted_docs}, chunks {deleted_chunks}, vectors {deleted_vectors}, markers {removed_markers}"
    )
    cat_update, select_update, doc_rows, overview_text, _, new_items = _refresh_ingest_list(
        str(output_path), ingest_category, status_filter, []
    )
    return status, _db_status_text(), cat_update, select_update, doc_rows, overview_text, new_items


def _clear_vectors_by_docs(
    ocr_output_dir: str,
    category: str,
    status_filter: str,
    selected_keys: list[str] | None,
    items: list[dict[str, Any]] | None
) -> tuple[str, str, Any, Any, list[list[Any]], str, list[dict[str, Any]]]:
    selected_keys = list(selected_keys or [])
    if not selected_keys:
        msg = "[WARN] \u672a\u9009\u62e9\u6587\u6863"
        cat_update, select_update, doc_rows, overview_text, _, new_items = _refresh_ingest_list(
            ocr_output_dir, category, status_filter, []
        )
        return msg, _db_status_text(), cat_update, select_update, doc_rows, overview_text, new_items

    try:
        db_manager = _ensure_db_initialized()
    except Exception as exc:
        msg = f"[FAIL] \u6570\u636e\u5e93\u521d\u59cb\u5316\u5931\u8d25: {exc}"
        cat_update, select_update, doc_rows, overview_text, _, new_items = _refresh_ingest_list(
            ocr_output_dir, category, status_filter, []
        )
        return msg, msg, cat_update, select_update, doc_rows, overview_text, new_items

    output_path = _resolve_output_dir(ocr_output_dir)
    items_map = {item.get("key"): item for item in (items or [])}
    doc_ids: list[str] = []
    removed_markers = 0
    for key in selected_keys:
        item = items_map.get(key) or {}
        doc_dir = item.get("doc_dir")
        doc_id = item.get("doc_id") or ""
        if not doc_id and item.get("markdown_path"):
            try:
                found = db_manager.mongodb.find_one(
                    "documents",
                    {"markdown_path": item.get("markdown_path")},
                    projection={"_id": 1},
                )
                if found:
                    doc_id = str(found.get("_id"))
            except Exception:
                doc_id = ""
        if doc_id:
            doc_ids.append(doc_id)
        if isinstance(doc_dir, Path) and _remove_marker_file(doc_dir):
            removed_markers += 1

    deleted_vectors = 0
    if doc_ids:
        try:
            deleted_vectors = db_manager.milvus.delete_by_doc_ids(
                config.MILVUS_COLLECTION_TEXT, doc_ids
            )
        except Exception:
            deleted_vectors = 0

    deleted_chunks = (
        db_manager.mongodb.delete_many("chunks", {"doc_id": {"$in": doc_ids}})
        if doc_ids
        else 0
    )
    deleted_docs = (
        db_manager.mongodb.delete_many("documents", {"_id": {"$in": doc_ids}})
        if doc_ids
        else 0
    )

    status = (
        f"[OK] \u5df2\u6e05\u7a7a\u9009\u4e2d\u5411\u91cf: "
        f"docs {deleted_docs}, chunks {deleted_chunks}, vectors {deleted_vectors}, markers {removed_markers}"
    )
    cat_update, select_update, doc_rows, overview_text, _, new_items = _refresh_ingest_list(
        str(output_path), category, status_filter, []
    )
    return status, _db_status_text(), cat_update, select_update, doc_rows, overview_text, new_items


def _create_ingestion_pipeline():
    modules = _get_rhino_modules()
    db_manager = modules["db_manager"]
    if not db_manager._initialized:
        db_manager.initialize()

    chunker = modules["DocumentChunker"](chunk_size=800, overlap=100)
    embedder = modules["create_embedding_service"]()
    vision = modules["create_vision_service"]()

    return modules["IngestionPipeline"](
        milvus_client=db_manager.milvus,
        mongodb_client=db_manager.mongodb,
        embedding_service=embedder,
        vision_service=vision,
        chunker=chunker,
        neo4j_client=db_manager.neo4j,
    )


def _selection_updates(items: list[dict[str, Any]], selected_keys: list[str]) -> tuple[Any, list[list[Any]], list[str]]:
    choices = _build_select_choices(items)
    selected = [k for k in (selected_keys or []) if k in choices]
    return gr.update(choices=choices, value=selected), _build_doc_table(items), selected


def _refresh_ingest_list(
    ocr_output_dir: str,
    category: str,
    status_filter: str,
    selected_keys: list[str] | None
) -> tuple[Any, Any, list[list[Any]], str, str, list[dict[str, Any]]]:
    items, categories, status = _load_documents(ocr_output_dir, ALL_CATEGORIES_LABEL)
    category_choices = [ALL_CATEGORIES_LABEL] + [c for c in categories if c != ALL_CATEGORIES_LABEL]
    if category in category_choices:
        category_value = category
    elif len(category_choices) > 1:
        category_value = category_choices[1]
    else:
        category_value = category_choices[0] if category_choices else ""
    filtered_items = _apply_category_filter(items, category_value)
    filtered_items = _apply_status_filter(filtered_items, status_filter)
    select_update, table_rows, selected = _selection_updates(filtered_items, selected_keys or [])
    overview_text = _ingest_overview_text(filtered_items)
    return (
        gr.update(choices=category_choices, value=category_value),
        select_update,
        table_rows,
        overview_text,
        status,
        filtered_items,
    )


def _refresh_ingest_panel(
    ocr_output_dir: str,
    category: str,
    status_filter: str,
    selected_keys: list[str] | None,
    db_category: str | None,
) -> tuple[Any, Any, list[list[Any]], str, list[dict[str, Any]], Any]:
    category_update, select_update, doc_rows, overview_text, status, items = _refresh_ingest_list(
        ocr_output_dir,
        category,
        status_filter,
        selected_keys,
    )
    return (
        category_update,
        select_update,
        doc_rows,
        overview_text,
        items,
        _db_category_update(db_category),
    )


def _clear_vectors_all_ui(
    ocr_output_dir: str,
    category: str,
    status_filter: str,
    selected_keys: list[str] | None,
    items: list[dict[str, Any]] | None,
    db_category: str | None,
) -> tuple[str, Any, Any, list[list[Any]], str, list[dict[str, Any]], Any]:
    status, _, category_update, select_update, doc_rows, overview_text, new_items = _clear_vectors_all(
        ocr_output_dir,
        category,
        status_filter,
        selected_keys,
        items,
    )
    return (
        status,
        category_update,
        select_update,
        doc_rows,
        overview_text,
        new_items,
        _db_category_update(db_category),
    )


def _clear_vectors_by_category_ui(
    ocr_output_dir: str,
    db_category: str,
    ingest_category: str,
    status_filter: str,
    selected_keys: list[str] | None,
    items: list[dict[str, Any]] | None,
) -> tuple[str, Any, Any, list[list[Any]], str, list[dict[str, Any]], Any]:
    status, _, category_update, select_update, doc_rows, overview_text, new_items = _clear_vectors_by_category(
        ocr_output_dir,
        db_category,
        ingest_category,
        status_filter,
        selected_keys,
        items,
    )
    return (
        status,
        category_update,
        select_update,
        doc_rows,
        overview_text,
        new_items,
        _db_category_update(db_category),
    )


def _select_all_docs(
    ocr_output_dir: str,
    category: str,
    status_filter: str,
) -> tuple[Any, list[dict[str, Any]], list[list[Any]], str]:
    _, _, table_rows, overview_text, _, filtered_items = _refresh_ingest_list(
        ocr_output_dir,
        category,
        status_filter,
        [],
    )
    keys = _build_select_choices(filtered_items)
    return (
        gr.update(choices=keys, value=keys),
        filtered_items,
        table_rows,
        overview_text,
    )


def _clear_selection() -> Any:
    return gr.update(value=[])


def _format_progress_bar(percent: int, width: int = 16) -> str:
    _ = width
    pct = max(0, min(100, int(percent)))
    return f"{pct}%"


def _ingest_progress_text(total: int, done: int, failed: int, skipped: int, current: float) -> str:
    progress = max(0.0, min(float(current), float(total))) if total else 0.0
    percent = int(round(progress / total * 100)) if total else 0
    return (
        f"[INFO] \u5165\u5e93\u8fdb\u5ea6: {int(progress)}/{total} ({percent}%) | "
        f"\u6210\u529f {done} | \u5931\u8d25 {failed} | \u8df3\u8fc7 {skipped}"
    )


def _ingest_result_text(total: int, done: int, failed: int, skipped: int) -> str:
    return (
        f"\u603b\u8ba1: {total}\n"
        f"\u6210\u529f: {done}\n"
        f"\u5931\u8d25: {failed}\n"
        f"\u8df3\u8fc7: {skipped}"
    )


def _find_item(items: list[dict[str, Any]], key: str) -> dict[str, Any] | None:
    for item in items:
        if item.get("key") == key:
            return item
    return None


def _ingest_batch_stream(
    selected_keys: list[str] | None,
    items: list[dict[str, Any]] | None,
    process_images: bool,
    status_filter: str,
) -> Iterable[tuple[Any, ...]]:
    items = list(items or [])
    selected_keys = list(selected_keys or [])

    def _update_view(current_items: list[dict[str, Any]], current_keys: list[str]) -> tuple[Any, list[list[Any]], str, list[str], list[dict[str, Any]]]:
        visible_items = _apply_status_filter(current_items, status_filter)
        select_update, doc_rows, selected = _selection_updates(visible_items, current_keys)
        overview_text = _ingest_overview_text(visible_items)
        return select_update, doc_rows, overview_text, selected, visible_items

    def _overall_percent(total_count: int, current_value: float) -> int:
        if total_count <= 0:
            return 0
        return max(0, min(100, int(round(max(0.0, min(current_value, float(total_count))) / total_count * 100))))

    if not items:
        select_update, doc_rows, overview_text, _, visible_items = _update_view(items, [])
        result_text = _ingest_result_text(0, 0, 0, 0)
        yield 0, result_text, [], doc_rows, select_update, overview_text, visible_items
        return

    if not selected_keys:
        select_update, doc_rows, overview_text, _, visible_items = _update_view(items, [])
        result_text = _ingest_result_text(0, 0, 0, 0)
        yield 0, result_text, [], doc_rows, select_update, overview_text, visible_items
        return

    try:
        pipeline = _create_ingestion_pipeline()
    except Exception:
        select_update, doc_rows, overview_text, _, visible_items = _update_view(items, selected_keys)
        result_text = _ingest_result_text(len(selected_keys), 0, len(selected_keys), 0)
        yield 0, result_text, [], doc_rows, select_update, overview_text, visible_items
        return

    total = len(selected_keys)
    done = 0
    failed = 0
    skipped = 0
    progress_rows: list[list[Any]] = []

    for idx, key in enumerate(selected_keys, start=1):
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        item = _find_item(items, key)

        if not item:
            skipped += 1
            progress_rows.append([key, "\u7f3a\u5931\u6587\u4ef6", _format_progress_bar(100), "", "", "\u672a\u627e\u5230\u6587\u6863\u6761\u76ee", now])
            select_update, doc_rows, overview_text, selected_keys, visible_items = _update_view(items, selected_keys)
            current_value = float(idx)
            yield (
                _overall_percent(total, current_value),
                _ingest_result_text(total, done, failed, skipped),
                progress_rows,
                doc_rows,
                select_update,
                overview_text,
                visible_items,
            )
            continue

        if item.get("ingested"):
            skipped += 1
            progress_rows.append([item.get("name", key), "\u5df2\u5165\u5e93(\u8df3\u8fc7)", _format_progress_bar(100), "", "", "", now])
            select_update, doc_rows, overview_text, selected_keys, visible_items = _update_view(items, selected_keys)
            current_value = float(idx)
            yield (
                _overall_percent(total, current_value),
                _ingest_result_text(total, done, failed, skipped),
                progress_rows,
                doc_rows,
                select_update,
                overview_text,
                visible_items,
            )
            continue

        if not item.get("ready"):
            failed += 1
            progress_rows.append([item.get("name", key), "\u7f3a\u5931\u6587\u4ef6", _format_progress_bar(100), "", "", item.get("error", ""), now])
            select_update, doc_rows, overview_text, selected_keys, visible_items = _update_view(items, selected_keys)
            current_value = float(idx)
            yield (
                _overall_percent(total, current_value),
                _ingest_result_text(total, done, failed, skipped),
                progress_rows,
                doc_rows,
                select_update,
                overview_text,
                visible_items,
            )
            continue

        progress_rows.append([item.get("name", key), "\u5904\u7406\u4e2d", _format_progress_bar(20), "", "", "", now])
        select_update, doc_rows, overview_text, selected_keys, visible_items = _update_view(items, selected_keys)
        current_value = (idx - 1) + 0.2
        yield (
            _overall_percent(total, current_value),
            _ingest_result_text(total, done, failed, skipped),
            progress_rows,
            doc_rows,
            select_update,
            overview_text,
            visible_items,
        )

        try:
            result = pipeline.ingest_document(
                item["markdown_path"],
                item["meta_path"],
                images_dir=item.get("images_dir"),
                process_images=process_images,
            )
            marker_payload = {
                "doc_id": result.get("doc_id", ""),
                "file_name": result.get("file_name", ""),
                "chunks_count": result.get("chunks_count", 0),
                "images_processed": result.get("images_processed", 0),
                "ingested_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            _write_marker(Path(item["doc_dir"]), marker_payload)
            item["ingested"] = True
            item["ingested_at"] = marker_payload["ingested_at"]
            item["images_count"] = int(result.get("images_processed") or item.get("images_count") or 0)

            if result.get("status") == "skipped":
                skipped += 1
                progress_rows[-1] = [
                    item.get("name", key),
                    "\u5df2\u5165\u5e93(\u8df3\u8fc7)",
                    _format_progress_bar(100),
                    result.get("chunks_count", 0),
                    result.get("images_processed", 0),
                    "",
                    marker_payload["ingested_at"],
                ]
            else:
                done += 1
                op = str(result.get("operation") or "")
                if op == "created":
                    status_text = "\u5b8c\u6210(\u65b0\u589e)"
                elif op == "updated":
                    status_text = "\u5b8c\u6210(\u66f4\u65b0)"
                elif op == "rollback":
                    status_text = "\u5b8c\u6210(\u56de\u6eda)"
                else:
                    status_text = "\u5b8c\u6210"

                progress_rows[-1] = [
                    item.get("name", key),
                    status_text,
                    _format_progress_bar(100),
                    result.get("chunks_count", 0),
                    result.get("images_processed", 0),
                    "",
                    marker_payload["ingested_at"],
                ]
        except Exception as exc:
            failed += 1
            error_msg = str(exc)[:500]
            progress_rows[-1] = [item.get("name", key), "\u5931\u8d25", _format_progress_bar(100), "", "", error_msg, now]

        select_update, doc_rows, overview_text, selected_keys, visible_items = _update_view(items, selected_keys)
        current_value = float(idx)
        yield (
            _overall_percent(total, current_value),
            _ingest_result_text(total, done, failed, skipped),
            progress_rows,
            doc_rows,
            select_update,
            overview_text,
            visible_items,
        )

    select_update, doc_rows, overview_text, _, visible_items = _update_view(items, [])
    yield (
        100,
        _ingest_result_text(total, done, failed, skipped),
        progress_rows,
        doc_rows,
        select_update,
        overview_text,
        visible_items,
    )


def _ingest_batch_stream_ui(
    selected_keys: list[str] | None,
    items: list[dict[str, Any]] | None,
    process_images: bool,
    status_filter: str,
) -> Iterable[tuple[Any, ...]]:
    for overall_percent, result_text, progress_rows, doc_rows, select_update, overview_text, visible_items in _ingest_batch_stream(
        selected_keys,
        items,
        process_images,
        status_filter,
    ):
        yield overall_percent, result_text, progress_rows, doc_rows, select_update, overview_text, visible_items


def _initial_destinations() -> tuple[list[str], str, str]:
    try:
        data = core.get_destinations()
    except core.OCRError as exc:
        return [], "", f"[FAIL] {exc.message}"
    destinations = data.get("destinations") or []
    value = destinations[0] if destinations else ""
    status = f"[INFO] \u8f93\u51fa\u76ee\u5f55: {data.get('root')}"
    return destinations, value, status


def build_app() -> gr.Blocks:
    destinations, default_dest, dest_status = _initial_destinations()

    default_ocr_dir = _default_ocr_output_dir()
    all_items, init_categories, _ = _load_documents(default_ocr_dir, ALL_CATEGORIES_LABEL)
    init_category_choices = [ALL_CATEGORIES_LABEL] + [c for c in init_categories if c != ALL_CATEGORIES_LABEL]
    default_category = init_categories[0] if init_categories else ALL_CATEGORIES_LABEL
    if default_category not in init_category_choices:
        default_category = ALL_CATEGORIES_LABEL
    status_filter_choices = [FILTER_ALL_LABEL, FILTER_PENDING_LABEL, FILTER_DONE_LABEL]
    default_status_filter = FILTER_ALL_LABEL
    init_items = _apply_category_filter(all_items, default_category)
    init_items = _apply_status_filter(init_items, default_status_filter)
    init_doc_table = _build_doc_table(init_items)
    init_select_choices = _build_select_choices(init_items)
    init_overview = _ingest_overview_text(init_items)
    init_db_category_choices = _db_category_choices()
    init_db_category_value = (
        init_db_category_choices[1]
        if len(init_db_category_choices) > 1
        else (init_db_category_choices[0] if init_db_category_choices else "")
    )

    with gr.Blocks(title="HDMS OCR") as demo:
        job_state = gr.State("")
        ingest_items_state = gr.State(init_items)
        ingest_dir_state = gr.State(default_ocr_dir)

        with gr.Tab("OCR"):
            with gr.Row():
                with gr.Column(scale=1):
                    files = gr.File(
                        label="PDF \u6587\u4ef6",
                        file_count="multiple",
                        file_types=[".pdf"],
                    )
                    destination = gr.Dropdown(
                        label="\u8f93\u51fa\u76ee\u5f55",
                        choices=destinations,
                        value=default_dest,
                        allow_custom_value=True,
                    )
                    refresh_dest_btn = gr.Button("\u5237\u65b0\u8f93\u51fa\u76ee\u5f55")
                    submit_btn = gr.Button("\u5f00\u59cb\u8bc6\u522b")
                    submit_status = gr.Textbox(
                        label="\u63d0\u4ea4\u72b6\u6001",
                        lines=6,
                        interactive=False,
                    )
                    dest_status_box = gr.Textbox(
                        label="\u8f93\u51fa\u6839\u76ee\u5f55",
                        value=dest_status,
                        lines=2,
                        interactive=False,
                    )

                with gr.Column(scale=1):
                    progress_text = gr.Textbox(
                        label="\u8fdb\u5ea6\u6982\u89c8",
                        lines=3,
                        interactive=False,
                    )
                    progress_table = gr.Dataframe(
                        headers=[
                            "\u6587\u4ef6",
                            "\u72b6\u6001",
                            "\u8fdb\u5ea6",
                            "\u9875\u6570",
                            "\u9519\u8bef",
                        ],
                        datatype=["str", "str", "str", "number", "str"],
                        value=[],
                        wrap=True,
                        interactive=False,
                    )
                    timer = gr.Timer(value=2, active=False)

                with gr.Column(scale=1):
                    summary_text = gr.Textbox(
                        label="\u7edf\u8ba1\u6982\u89c8",
                        value="[INFO] \u70b9\u51fb\u5237\u65b0\u83b7\u53d6\u7edf\u8ba1",
                        lines=5,
                        interactive=False,
                    )
                    summary_table = gr.Dataframe(
                        headers=["\u5206\u7c7b", "\u6587\u4ef6\u6570", "\u9875\u6570", "\u56fe\u7247\u6570"],
                        datatype=["str", "number", "number", "number"],
                        value=[],
                        wrap=True,
                        interactive=False,
                    )
                    refresh_summary_btn = gr.Button("\u5237\u65b0\u7edf\u8ba1")
                    clear_output_btn = gr.Button("\u6e05\u7a7a\u8f93\u51fa\u76ee\u5f55")

        with gr.Tab("\u5411\u91cf\u5316\u5165\u5e93"):
            with gr.Row():
                with gr.Column(scale=1):
                    ingest_category = gr.Dropdown(
                        label="\u6587\u6863\u5411\u91cf\u5316\u9009\u62e9",
                        choices=init_category_choices,
                        value=default_category,
                    )
                    status_filter = gr.Radio(
                        label="\u7b5b\u9009",
                        choices=status_filter_choices,
                        value=default_status_filter,
                        interactive=True,
                    )
                    refresh_ingest_btn = gr.Button("\u5237\u65b0\u5217\u8868")
                    ingest_overview = gr.Textbox(
                        label="\u5411\u91cf\u5316\u6982\u89c8",
                        value=init_overview,
                        lines=2,
                        interactive=False,
                    )
                    doc_select = gr.CheckboxGroup(
                        label="\u53ef\u5411\u91cf\u5316\u6587\u6863",
                        choices=init_select_choices,
                        value=[],
                    )
                    with gr.Row():
                        select_all_btn = gr.Button("\u5168\u9009")
                        clear_select_btn = gr.Button("\u6e05\u7a7a\u9009\u62e9")
                    doc_table = gr.Dataframe(
                        headers=[
                            "\u72b6\u6001",
                            "\u6587\u6863",
                            "\u5206\u7c7b",
                            "Chunk\u6570",
                            "\u56fe\u7247\u6570",
                            "\u5165\u5e93\u65f6\u95f4",
                            "\u5907\u6ce8",
                        ],
                        datatype=["str", "str", "str", "number", "number", "str", "str"],
                        value=init_doc_table,
                        wrap=True,
                        interactive=False,
                    )

                with gr.Column(scale=1):
                    process_images = gr.State(True)
                    db_category = gr.Dropdown(
                        label="\u5411\u91cf\u5220\u9664\u5206\u7c7b",
                        choices=init_db_category_choices,
                        value=init_db_category_value,
                    )
                    with gr.Row():
                        clear_vectors_all_btn = gr.Button("\u5220\u9664\u5411\u91cf(\u5168\u90e8)")
                        clear_vectors_category_btn = gr.Button("\u5220\u9664\u5f53\u524d\u5206\u7c7b")
                    ingest_btn = gr.Button("\u5f00\u59cb\u5165\u5e93")
                    ingest_overall_progress = gr.Slider(
                        label="\u6574\u4f53\u5165\u5e93\u8fdb\u5ea6(%)",
                        minimum=0,
                        maximum=100,
                        step=1,
                        value=0,
                        interactive=False,
                    )
                    ingest_result_box = gr.Textbox(
                        label="\u5165\u5e93\u7ed3\u679c",
                        value="\u603b\u8ba1: 0\n\u6210\u529f: 0\n\u5931\u8d25: 0\n\u8df3\u8fc7: 0",
                        lines=4,
                        interactive=False,
                    )
                    acceptance_btn = gr.Button("\u4e00\u952e\u9a8c\u6536")
                    acceptance_box = gr.Textbox(
                        label="\u9a8c\u6536\u7ed3\u679c",
                        value="[INFO] \u5c1a\u672a\u6267\u884c",
                        lines=6,
                        interactive=False,
                    )
                    ingest_table = gr.Dataframe(
                        headers=[
                            "\u6587\u6863",
                            "\u72b6\u6001",
                            "\u8fdb\u5ea6",
                            "\u5206\u7247\u6570",
                            "\u56fe\u7247\u6570",
                            "\u9519\u8bef",
                            "\u65f6\u95f4",
                        ],
                        datatype=["str", "str", "str", "number", "number", "str", "str"],
                        value=[],
                        wrap=True,
                        interactive=False,
                    )

        demo.load(_init_ui, outputs=[destination, dest_status_box, summary_text, summary_table])

        refresh_dest_btn.click(_refresh_destinations, outputs=[destination, dest_status_box])
        refresh_summary_btn.click(_refresh_summary, outputs=[summary_text, summary_table])
        clear_output_btn.click(_clear_outputs, outputs=[submit_status, summary_text, summary_table, destination])

        submit_btn.click(
            _submit,
            inputs=[files, destination],
            outputs=[job_state, submit_status, progress_text, progress_table, summary_text, summary_table, timer],
        )
        timer.tick(
            _poll,
            inputs=job_state,
            outputs=[progress_text, progress_table, summary_text, summary_table, timer],
        )

        refresh_ingest_btn.click(
            _refresh_ingest_panel,
            inputs=[ingest_dir_state, ingest_category, status_filter, doc_select, db_category],
            outputs=[ingest_category, doc_select, doc_table, ingest_overview, ingest_items_state, db_category],
        )
        ingest_category.change(
            _refresh_ingest_panel,
            inputs=[ingest_dir_state, ingest_category, status_filter, doc_select, db_category],
            outputs=[ingest_category, doc_select, doc_table, ingest_overview, ingest_items_state, db_category],
        )
        status_filter.change(
            _refresh_ingest_panel,
            inputs=[ingest_dir_state, ingest_category, status_filter, doc_select, db_category],
            outputs=[ingest_category, doc_select, doc_table, ingest_overview, ingest_items_state, db_category],
        )
        select_all_btn.click(
            _select_all_docs,
            inputs=[ingest_dir_state, ingest_category, status_filter],
            outputs=[doc_select, ingest_items_state, doc_table, ingest_overview],
        )
        clear_select_btn.click(
            _clear_selection,
            outputs=[doc_select],
        )
        clear_vectors_all_btn.click(
            _clear_vectors_all_ui,
            inputs=[ingest_dir_state, ingest_category, status_filter, doc_select, ingest_items_state, db_category],
            outputs=[acceptance_box, ingest_category, doc_select, doc_table, ingest_overview, ingest_items_state, db_category],
        )
        clear_vectors_category_btn.click(
            _clear_vectors_by_category_ui,
            inputs=[ingest_dir_state, db_category, ingest_category, status_filter, doc_select, ingest_items_state],
            outputs=[acceptance_box, ingest_category, doc_select, doc_table, ingest_overview, ingest_items_state, db_category],
        )

        acceptance_btn.click(
            _run_ingest_acceptance_check,
            outputs=[acceptance_box],
        )

        ingest_btn.click(
            _ingest_batch_stream_ui,
            inputs=[doc_select, ingest_items_state, process_images, status_filter],
            outputs=[
                ingest_overall_progress,
                ingest_result_box,
                ingest_table,
                doc_table,
                doc_select,
                ingest_overview,
                ingest_items_state,
            ],
        )

    return demo


demo = build_app()

if __name__ == "__main__":
    demo.launch()

