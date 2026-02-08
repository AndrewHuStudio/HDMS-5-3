from __future__ import annotations

import http.client
import json
import logging
import os
import shutil
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class OCRError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _ensure_default_destination(root: Path) -> None:
    # Keep the helper usable out-of-the-box even if `data/ocr_output` is empty.
    try:
        if not any(p.is_dir() for p in root.iterdir()):
            (root / "默认").mkdir(parents=True, exist_ok=True)
    except FileNotFoundError:
        root.mkdir(parents=True, exist_ok=True)
        (root / "默认").mkdir(parents=True, exist_ok=True)


def _find_env_file() -> Path | None:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".env"
        if candidate.exists():
            return candidate
    return None


def _project_root() -> Path:
    """
    Determine the repo root so relative paths (e.g. data/ocr_output) work
    no matter where the app is launched from.
    """
    env_path = _find_env_file()
    if env_path:
        return env_path.parent.resolve()
    # data_process/ocr_process/core.py -> data_process -> repo root
    try:
        return Path(__file__).resolve().parents[3]
    except Exception:
        return Path.cwd().resolve()


def _resolve_path(value: str, default_rel: str) -> Path:
    root = _project_root()
    raw = (value or "").strip() or default_rel
    p = Path(raw)
    if p.is_absolute():
        return p
    return (root / p).resolve()


def _read_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        content = env_path.read_text(encoding="utf-8")
    except OSError:
        return values
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'").strip()
        if key and key not in values:
            values[key] = value
    return values


def _load_setting(key: str, default: str = "") -> str:
    value = os.getenv(key, "").strip()
    if value:
        return value
    env_path = _find_env_file()
    if env_path:
        env_values = _read_env_file(env_path)
        return env_values.get(key, default).strip()
    return default


def _normalize_mineru_base(url: str) -> str:
    if not url:
        return "https://mineru.net/api/v4"
    if "/api/" in url:
        prefix, rest = url.split("/api/", 1)
        version = rest.split("/", 1)[0]
        return f"{prefix}/api/{version}"
    return url.rstrip("/")


def _http_json(method: str, url: str, payload: dict | None, headers: dict[str, str]) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8") if exc.fp else str(exc)
        raise OCRError(detail, status_code=exc.code) from exc
    except urllib.error.URLError as exc:
        raise OCRError(f"MinerU request failed: {exc}", status_code=502) from exc
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise OCRError("Invalid MinerU response", status_code=502) from exc


def _http_put(url: str, file_path: Path) -> None:
    """
    MinerU returns a pre-signed OSS URL for PUT. urllib adds a default
    `Content-Type: application/x-www-form-urlencoded` when `data` is present,
    which can break the signature. Use http.client to control headers.
    """
    data = file_path.read_bytes()
    parts = urllib.parse.urlsplit(url)
    if not parts.scheme or not parts.netloc:
        raise OCRError("Invalid upload URL from MinerU", status_code=502)

    path = parts.path + (f"?{parts.query}" if parts.query else "")
    timeout = 600

    conn: http.client.HTTPConnection
    if parts.scheme.lower() == "https":
        conn = http.client.HTTPSConnection(parts.hostname, parts.port or 443, timeout=timeout)
    else:
        conn = http.client.HTTPConnection(parts.hostname, parts.port or 80, timeout=timeout)

    try:
        # Keep headers minimal to match the signature. Content-Length is safe.
        conn.request("PUT", path, body=data, headers={"Content-Length": str(len(data))})
        resp = conn.getresponse()
        body = resp.read() or b""
        if resp.status >= 400:
            detail = body.decode("utf-8", errors="ignore").strip()
            raise OCRError(detail or f"Upload failed: {resp.status}", status_code=resp.status)
    except OCRError:
        raise
    except Exception as exc:
        raise OCRError(f"Upload failed: {exc}", status_code=502) from exc
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _compact_upload_error(detail: str) -> str:
    """
    OSS errors can be very large XML. Compact to a readable single-line summary.
    """
    raw = (detail or "").strip()
    if not raw:
        return "Upload failed"
    if "<Error>" not in raw or "<Code>" not in raw:
        return raw[:600]

    def _pick(tag: str) -> str:
        start = raw.find(f"<{tag}>")
        end = raw.find(f"</{tag}>")
        if start == -1 or end == -1 or end <= start:
            return ""
        start += len(tag) + 2
        return raw[start:end].strip()

    code = _pick("Code")
    msg = _pick("Message")
    req = _pick("RequestId")
    host = _pick("HostId")
    parts = [p for p in [code, msg] if p]
    if req:
        parts.append(f"RequestId={req}")
    if host:
        parts.append(f"HostId={host}")
    return " | ".join(parts)[:600]


def _normalize_error_message(message: str, exc_type: str = "") -> str:
    """Normalize error message for display in UI."""
    msg = (message or "").strip()
    if not msg or msg == "0":
        if exc_type:
            return f"处理失败: {exc_type}"
        return "处理失败: 未知错误"
    return msg[:600]


def _count_pdf_pages(file_path: Path) -> int:
    try:
        from pypdf import PdfReader  # type: ignore

        return len(PdfReader(str(file_path)).pages)
    except Exception:
        return 0


def _download_and_extract_markdown(zip_url: str) -> tuple[str, str, list[tuple[str, bytes]]]:
    try:
        with urllib.request.urlopen(zip_url, timeout=300) as response:
            data = response.read()
    except Exception as exc:
        raise OCRError(f"Download result failed: {exc}", status_code=502) from exc

    with zipfile.ZipFile(BytesIO(data)) as zf:
        md_names = [n for n in zf.namelist() if n.lower().endswith(".md")]
        if not md_names:
            raise OCRError("No markdown found in MinerU output", status_code=502)
        md_name = sorted(md_names)[0]
        md_text = zf.read(md_name).decode("utf-8", errors="ignore")
        image_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}
        image_items: list[tuple[str, bytes]] = []
        for n in zf.namelist():
            lower = n.lower()
            if lower.endswith("/") or lower.endswith("\\"):
                continue
            if Path(lower).suffix not in image_exts:
                continue
            try:
                image_items.append((n, zf.read(n)))
            except Exception:
                continue
        return md_name, md_text, image_items


def _safe_subdir(root: Path, name: str) -> Path:
    """Resolve a user-provided folder name under a root directory safely."""
    cleaned = (name or "").strip().replace("\\", "/").strip("/")
    if not cleaned or cleaned in {".", ".."} or ".." in cleaned.split("/"):
        raise OCRError("Invalid folder name", status_code=400)
    resolved = (root / cleaned).resolve()
    if root not in resolved.parents and resolved != root:
        raise OCRError("Invalid folder path", status_code=400)
    return resolved


def _list_source_files(source_dir: Path, recursive: bool) -> list[Path]:
    patterns = ["*.pdf"]
    files: list[Path] = []
    if recursive:
        for pat in patterns:
            files.extend(source_dir.rglob(pat))
    else:
        for pat in patterns:
            files.extend(source_dir.glob(pat))
    # deterministic ordering
    return sorted({p.resolve() for p in files if p.is_file()}, key=lambda p: p.name.lower())


# ----------------------------
# Job store (in-memory)
# ----------------------------
_jobs_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}
_worker_sema = threading.Semaphore(int(os.getenv("OCR_MAX_WORKERS", "2")))


def _job_set(job_id: str, update: dict[str, Any]) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(update)


def _job_update_file(job_id: str, file_id: str, update: dict[str, Any]) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        for item in job.get("files", []):
            if item.get("id") == file_id:
                item.update(update)
                break
        job["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")


def _poll_progress(extract_result: dict[str, Any]) -> tuple[int, int, int]:
    progress = extract_result.get("extract_progress") or {}
    try:
        total_pages = int(progress.get("total_pages") or 0)
    except Exception:
        total_pages = 0
    try:
        processed_pages = int(
            progress.get("processed_pages")
            or progress.get("done_pages")
            or progress.get("extracted_pages")
            or 0
        )
    except Exception:
        processed_pages = 0
    if total_pages > 0:
        percent = min(99, int(processed_pages * 100 / total_pages))
    else:
        # Fallback when pages are not available: "processing" ~ 50%.
        percent = 50
    return percent, processed_pages, total_pages


def _select_extract_result(
    data: Any,
    *,
    data_id: str | None = None,
    file_name: str | None = None,
) -> dict[str, Any] | None:
    if not data:
        return None

    # Newer responses wrap results in data.extract_result (list or dict).
    if isinstance(data, dict) and "extract_result" in data:
        results = data.get("extract_result")
        if isinstance(results, dict):
            return results
        if isinstance(results, list):
            match_name = (file_name or "").strip()
            match_name = Path(match_name).name.lower() if match_name else ""
            for item in results:
                if not isinstance(item, dict):
                    continue
                if data_id and str(item.get("data_id") or "") == data_id:
                    return item
                if match_name:
                    item_name = str(item.get("file_name") or "")
                    if Path(item_name).name.lower() == match_name:
                        return item
            return results[0] if results else None
        return None

    # Some endpoints may return the extract result directly.
    if isinstance(data, dict) and (
        "state" in data or "status" in data or "full_zip_url" in data or "result_url" in data
    ):
        return data

    # Fallback: API might return a list directly.
    if isinstance(data, list):
        for item in data:
            if not isinstance(item, dict):
                continue
            if data_id and str(item.get("data_id") or "") == data_id:
                return item
            if file_name and Path(str(item.get("file_name") or "")).name.lower() == Path(file_name).name.lower():
                return item
        return data[0] if data else None

    return None


def _process_one_file(
    *,
    job_id: str,
    file_id: str,
    tmp_file: Path,
    original_name: str,
    category: str,
) -> None:
    # Limit concurrent OCR jobs to avoid API throttling / local resource spikes.
    with _worker_sema:
        api_key = _load_setting("MINERU_API_KEY")
        base_url = _load_setting("MINERU_BASE_URL", "https://mineru.net/api/v4")
        model_version = _load_setting("MINERU_MODEL_VERSION", "vlm")
        output_root = str(_resolve_path(_load_setting("OCR_OUTPUT_DIR"), "data/ocr_output"))

        if not api_key:
            logger.error(f"[Job {job_id[:8]}] MINERU_API_KEY is not set")
            _job_update_file(
                job_id, file_id, {"status": "failed", "error": "MINERU_API_KEY 未设置", "progress": 0}
            )
            return

        logger.info(f"[Job {job_id[:8]}] Processing file: {original_name}")

        base_root = _normalize_mineru_base(base_url)
        file_urls_endpoint = f"{base_root}/file-urls/batch"
        results_endpoint = f"{base_root}/extract-results/batch"

        suffix = Path(original_name).suffix.lower()
        total_pages = _count_pdf_pages(tmp_file) if suffix == ".pdf" else 0

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        data_id = tmp_file.stem
        payload = {
            "files": [
                {
                    "name": Path(original_name or tmp_file.name).name,
                    "data_id": data_id,
                    "is_ocr": True,
                    "model_version": model_version,
                }
            ]
        }

        _job_update_file(job_id, file_id, {"status": "requesting", "progress": 2})

        try:
            logger.info(f"[Job {job_id[:8]}] Requesting upload URL from MinerU")
            resp = _http_json("POST", file_urls_endpoint, payload, headers)
            if resp.get("code") not in (0, 200):
                error_msg = f"MinerU API 返回错误: code={resp.get('code')}, msg={resp.get('msg', 'unknown')}"
                logger.error(f"[Job {job_id[:8]}] {error_msg}")
                raise RuntimeError(error_msg)

            data = resp.get("data") or {}
            batch_id = data.get("batch_id")
            file_urls = data.get("file_urls") or data.get("files") or []
            if not batch_id or not file_urls:
                logger.error(f"[Job {job_id[:8]}] MinerU response missing batch_id or file_urls: {resp}")
                raise RuntimeError("MinerU 未返回上传 URL")

            logger.info(f"[Job {job_id[:8]}] Got batch_id: {batch_id}, uploading file")
            _job_update_file(job_id, file_id, {"status": "uploading", "progress": 8, "batch_id": batch_id})
            _http_put(file_urls[0], tmp_file)
            logger.info(f"[Job {job_id[:8]}] File uploaded successfully")

            _job_update_file(job_id, file_id, {"status": "processing", "progress": 12})

            poll_timeout = int(_load_setting("MINERU_POLL_TIMEOUT", "300"))
            poll_interval = int(_load_setting("MINERU_POLL_INTERVAL", "3"))
            start = time.time()
            extract_result: dict[str, Any] | None = None
            last_state = ""

            logger.info(f"[Job {job_id[:8]}] Polling for OCR results (timeout: {poll_timeout}s)")
            while time.time() - start < poll_timeout:
                res = _http_json("GET", f"{results_endpoint}/{batch_id}", None, headers)
                if res.get("code") not in (0, 200):
                    error_msg = f"MinerU 轮询错误: code={res.get('code')}, msg={res.get('msg', 'unknown')}"
                    logger.error(f"[Job {job_id[:8]}] {error_msg}")
                    raise RuntimeError(error_msg)

                # MinerU API 返回的 data 是字典，不是列表
                data_result = res.get("data")
                extract_result = _select_extract_result(
                    data_result,
                    data_id=data_id,
                    file_name=original_name,
                )
                if not extract_result:
                    logger.debug(f"[Job {job_id[:8]}] Waiting for result, data: {data_result}")
                    time.sleep(poll_interval)
                    continue

                state = (extract_result.get("state") or extract_result.get("status") or "").lower()
                last_state = state
                if state == "done":
                    _, processed, tp = _poll_progress(extract_result)
                    if tp > 0:
                        total_pages = tp
                    logger.info(f"[Job {job_id[:8]}] OCR completed, downloading results")
                    _job_update_file(
                        job_id,
                        file_id,
                        {
                            "status": "downloading",
                            "progress": 95,
                            "processed_pages": processed,
                            "total_pages": total_pages,
                        },
                    )
                    break
                if state == "failed":
                    error_detail = (
                        extract_result.get("error")
                        or extract_result.get("message")
                        or extract_result.get("error_msg")
                        or "未知原因"
                    )
                    logger.error(f"[Job {job_id[:8]}] MinerU OCR failed: {error_detail}")
                    raise RuntimeError(f"MinerU OCR 失败: {error_detail}")

                percent, processed, tp = _poll_progress(extract_result)
                if tp > 0:
                    total_pages = tp
                _job_update_file(
                    job_id,
                    file_id,
                    {
                        "status": "processing",
                        "progress": max(12, percent),
                        "processed_pages": processed,
                        "total_pages": tp or total_pages,
                    },
                )
                time.sleep(poll_interval)

            if not extract_result:
                logger.error(f"[Job {job_id[:8]}] OCR timeout after {poll_timeout}s")
                raise RuntimeError(f"MinerU OCR 超时 (>{poll_timeout}s)")
            if last_state != "done":
                logger.error(f"[Job {job_id[:8]}] OCR timeout after {poll_timeout}s, state={last_state}")
                raise RuntimeError(f"MinerU OCR 超时 (>{poll_timeout}s)")

            zip_url = extract_result.get("full_zip_url")
            if not zip_url:
                alt_url = str(extract_result.get("result_url") or "")
                if alt_url.lower().endswith(".zip"):
                    zip_url = alt_url
            if not zip_url:
                logger.error(f"[Job {job_id[:8]}] MinerU response missing full_zip_url: {extract_result}")
                raise RuntimeError("MinerU 未返回结果压缩包")

            logger.info(f"[Job {job_id[:8]}] Downloading and extracting markdown")
            md_name, md_text, image_items = _download_and_extract_markdown(zip_url)

            doc_name = Path(original_name or tmp_file.name).stem
            category_safe = category.strip()
            out_dir = Path(output_root) / (category_safe if category_safe else "") / doc_name
            out_dir.mkdir(parents=True, exist_ok=True)
            md_path = out_dir / f"{doc_name}.md"
            md_path.write_text(md_text, encoding="utf-8")
            if image_items:
                images_dir = out_dir / "images"
                images_dir.mkdir(parents=True, exist_ok=True)
                for rel_name, blob in image_items:
                    rel_path = Path(rel_name)
                    if rel_path.is_absolute():
                        rel_path = Path(rel_path.name)
                    safe_path = (
                        images_dir / rel_path.name
                        if "images" not in rel_path.parts
                        else images_dir / Path(*rel_path.parts[rel_path.parts.index("images") + 1 :])
                    )
                    try:
                        safe_path = safe_path.resolve()
                    except Exception:
                        continue
                    if images_dir not in safe_path.parents and safe_path != images_dir:
                        continue
                    safe_path.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        safe_path.write_bytes(blob)
                    except Exception:
                        continue

            meta_path = out_dir / f"{doc_name}.meta.json"
            meta = {
                "file_name": original_name,
                "category": category_safe or "",
                "batch_id": batch_id,
                "markdown_file": md_name,
                "pages": total_pages,
                "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

            logger.info(f"[Job {job_id[:8]}] File processed successfully: {original_name}")
            _job_update_file(
                job_id,
                file_id,
                {
                    "status": "done",
                    "progress": 100,
                    "pages": total_pages,
                    "markdown_path": str(md_path),
                    "output_dir": str(out_dir),
                    "updated_at": meta["updated_at"],
                },
            )
        except Exception as exc:
            # Log full exception with traceback for debugging
            exc_type = type(exc).__name__
            exc_msg = str(exc)
            exc_trace = traceback.format_exc()
            logger.error(f"[Job {job_id[:8]}] Error processing {original_name}:\n{exc_trace}")

            # Prepare user-friendly error message
            if isinstance(exc, OCRError):
                msg = _compact_upload_error(str(exc.message))
            elif exc_msg:
                msg = exc_msg
            else:
                msg = ""

            error_display = _normalize_error_message(msg, exc_type)
            _job_update_file(
                job_id,
                file_id,
                {"status": "failed", "error": error_display, "progress": 0},
            )
        finally:
            try:
                tmp_file.unlink(missing_ok=True)
            except Exception:
                pass


def get_sources() -> dict:
    root = _resolve_path(_load_setting("OCR_INPUT_DIR"), "data/documents")
    root.mkdir(parents=True, exist_ok=True)

    sources: list[dict[str, Any]] = []
    # Include root itself
    total_files = len(_list_source_files(root, recursive=False))
    sources.append({"key": "(root)", "label": "(根目录)", "total_files": total_files})

    for d in sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: p.name.lower()):
        cnt = len(_list_source_files(d, recursive=True))
        sources.append({"key": d.name, "label": d.name, "total_files": cnt})

    return {"root": str(root), "sources": sources}


def get_destinations() -> dict:
    root = _resolve_path(_load_setting("OCR_OUTPUT_DIR"), "data/ocr_output")
    root.mkdir(parents=True, exist_ok=True)
    _ensure_default_destination(root)
    destinations = [p.name for p in root.iterdir() if p.is_dir()]
    destinations_sorted = sorted(destinations, key=lambda s: s.lower())
    return {"root": str(root), "destinations": destinations_sorted}


def clear_output_dir() -> dict:
    root = _resolve_path(_load_setting("OCR_OUTPUT_DIR"), "data/ocr_output")
    if not root.exists():
        root.mkdir(parents=True, exist_ok=True)
        _ensure_default_destination(root)
        return {"deleted": 0}

    deleted = 0
    for item in root.iterdir():
        try:
            if item.is_dir():
                shutil.rmtree(item, ignore_errors=True)
                deleted += 1
            else:
                item.unlink(missing_ok=True)
                deleted += 1
        except Exception:
            continue

    _ensure_default_destination(root)
    return {"deleted": deleted}


def submit_ocr_job(
    file_paths: list[Path],
    original_names: list[str],
    category: str = "",
) -> dict:
    if not file_paths:
        raise OCRError("No files uploaded", status_code=400)

    if not original_names:
        original_names = [Path(p).name for p in file_paths]

    if len(file_paths) != len(original_names):
        raise OCRError("Invalid file list", status_code=400)

    output_root = _resolve_path(_load_setting("OCR_OUTPUT_DIR"), "data/ocr_output")
    output_root.mkdir(parents=True, exist_ok=True)
    category = (category or "").strip()
    if category:
        category_path = _safe_subdir(output_root, category)
        category_path.mkdir(parents=True, exist_ok=True)

    tmp_dir = _resolve_path("", "data/ocr_tmp")
    tmp_dir.mkdir(parents=True, exist_ok=True)
    job_id = uuid.uuid4().hex
    created_at = time.strftime("%Y-%m-%d %H:%M:%S")
    file_entries: list[dict[str, Any]] = []
    rejected_files: list[str] = []

    for src_path, original_name in zip(file_paths, original_names):
        original_name = original_name or "upload"
        source = Path(src_path)
        suffix = Path(original_name).suffix.lower() or source.suffix.lower()
        if suffix not in {".pdf"}:
            rejected_files.append(original_name)
            continue
        if not source.exists() or not source.is_file():
            rejected_files.append(original_name)
            continue
        tmp_file = tmp_dir / f"{uuid.uuid4().hex}_{Path(original_name).name}"
        try:
            shutil.copyfile(source, tmp_file)
        except Exception:
            rejected_files.append(original_name)
            continue

        file_id = uuid.uuid4().hex
        file_entries.append(
            {
                "id": file_id,
                "file_name": original_name,
                "category": category or "",
                "status": "queued",
                "progress": 0,
                "tmp_file": str(tmp_file),
                "created_at": created_at,
                "updated_at": created_at,
            }
        )

    if not file_entries:
        raise OCRError("No supported files found", status_code=400)

    with _jobs_lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "created_at": created_at,
            "updated_at": created_at,
            "files": file_entries,
        }

    for item in file_entries:
        tmp_file = Path(item["tmp_file"])
        file_id = item["id"]
        original_name = item["file_name"]
        threading.Thread(
            target=_process_one_file,
            kwargs={
                "job_id": job_id,
                "file_id": file_id,
                "tmp_file": tmp_file,
                "original_name": original_name,
                "category": category or "",
            },
            daemon=True,
        ).start()

    return {
        "job_id": job_id,
        "accepted_count": len(file_entries),
        "rejected_count": len(rejected_files),
        "rejected_files": rejected_files[:50],
        "files": [{"id": f["id"], "file_name": f["file_name"]} for f in file_entries],
    }


def submit_ocr_job_from_source(source: str, destination: str, recursive: bool = True) -> dict:
    src_root = _resolve_path(_load_setting("OCR_INPUT_DIR"), "data/documents")
    src_root.mkdir(parents=True, exist_ok=True)
    out_root = _resolve_path(_load_setting("OCR_OUTPUT_DIR"), "data/ocr_output")
    out_root.mkdir(parents=True, exist_ok=True)

    source_key = (source or "").strip()
    source_dir = src_root if source_key in {"(root)", "(根目录)", ""} else _safe_subdir(src_root, source_key)
    if not source_dir.exists() or not source_dir.is_dir():
        raise OCRError("Source directory not found", status_code=404)

    destination = (destination or "").strip()
    if destination:
        dest_path = _safe_subdir(out_root, destination)
        dest_path.mkdir(parents=True, exist_ok=True)

    files = _list_source_files(source_dir, recursive=recursive)
    if not files:
        raise OCRError("No supported files in source directory", status_code=400)

    return submit_ocr_job(files, [p.name for p in files], destination)


def get_job_status(job_id: str) -> dict | None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        # Hide tmp_file paths from UI.
        safe_files = []
        for f in job.get("files", []):
            item = dict(f)
            item.pop("tmp_file", None)
            safe_files.append(item)
        return {
            "job_id": job["job_id"],
            "created_at": job["created_at"],
            "updated_at": job["updated_at"],
            "files": safe_files,
        }


def get_summary() -> dict:
    output_root = _resolve_path(_load_setting("OCR_OUTPUT_DIR"), "data/ocr_output")
    documents: list[dict[str, Any]] = []
    total_pages = 0
    total_images = 0
    categories: dict[str, dict[str, int]] = {}
    image_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}

    if output_root.exists():
        for md in output_root.rglob("*.md"):
            if md.name.endswith(".meta.md"):
                continue
            meta_path = md.with_suffix(".meta.json")
            meta: dict[str, Any] = {}
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception:
                    meta = {}
            pages = int(meta.get("pages") or 0)
            if pages > 0:
                total_pages += pages

            doc_images = 0
            images_dir = md.parent / "images"
            if images_dir.exists():
                try:
                    doc_images = sum(
                        1 for p in images_dir.rglob("*") if p.is_file() and p.suffix.lower() in image_exts
                    )
                    total_images += doc_images
                except Exception:
                    doc_images = 0

            category = md.parent.parent.name if md.parent.parent != output_root else md.parent.name
            cat = categories.setdefault(category, {"total_files": 0, "total_pages": 0, "total_images": 0})
            cat["total_files"] += 1
            cat["total_pages"] += pages
            cat["total_images"] += doc_images

            documents.append(
                {
                    "name": md.stem,
                    "category": category,
                    "markdown_path": str(md),
                    "pages": pages,
                    "updated_at": meta.get("updated_at")
                    or time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(md.stat().st_mtime)),
                }
            )

    category_list = [
        {"category": name, **vals} for name, vals in sorted(categories.items(), key=lambda x: x[0])
    ]
    documents_sorted = sorted(documents, key=lambda d: (d["category"], d["name"]))

    return {
        "total_files": len(documents_sorted),
        "total_pages": total_pages,
        "total_images": total_images,
        "categories": category_list,
        "documents": documents_sorted,
    }
