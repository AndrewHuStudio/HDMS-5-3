from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from .core import (
    OCRError,
    clear_output_dir,
    get_destinations,
    get_job_status,
    get_sources,
    get_summary,
    submit_ocr_job,
    submit_ocr_job_from_source,
)


app = FastAPI(title="HDMS OCR Helper")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class OCRSummary(BaseModel):
    total_files: int
    total_pages: int
    total_images: int
    categories: list[dict[str, Any]]
    documents: list[dict[str, Any]]


class SourceItem(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    key: str
    label: str
    total_files: int


class SourcesResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    root: str
    sources: list[SourceItem]


class DestinationsResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    root: str
    destinations: list[str]


class CreateJobFromSourceRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    source: str = Field(..., min_length=1)
    destination: str = Field(..., min_length=1)
    recursive: bool = True


@app.get("/api/sources", response_model=SourcesResponse)
def list_sources() -> SourcesResponse:
    try:
        return get_sources()
    except OCRError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@app.get("/api/destinations", response_model=DestinationsResponse)
def list_destinations() -> DestinationsResponse:
    try:
        return get_destinations()
    except OCRError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@app.post("/api/outputs/clear")
def clear_outputs() -> dict:
    try:
        return clear_output_dir()
    except OCRError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@app.post("/api/jobs")
def create_jobs(
    files: list[UploadFile] = File(...),
    category: str = Form(""),
) -> dict:
    """Create an OCR job for multiple files and process them in background threads."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    temp_paths: list[Path] = []
    original_names: list[str] = []
    rejected_files: list[str] = []

    for up in files:
        original_name = up.filename or "upload"
        suffix = Path(original_name).suffix.lower()
        if suffix not in {".pdf"}:
            rejected_files.append(original_name)
            continue
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                shutil.copyfileobj(up.file, tmp)
                temp_paths.append(Path(tmp.name))
                original_names.append(original_name)
        except Exception:
            rejected_files.append(original_name)
            continue

    if not temp_paths:
        raise HTTPException(status_code=400, detail="No supported files found")

    try:
        result = submit_ocr_job(temp_paths, original_names, category)
    except OCRError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    finally:
        for p in temp_paths:
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass

    if rejected_files:
        result["rejected_count"] = result.get("rejected_count", 0) + len(rejected_files)
        result["rejected_files"] = (result.get("rejected_files", []) + rejected_files)[:50]

    return result


@app.post("/api/jobs/from-source")
def create_job_from_source(request: CreateJobFromSourceRequest) -> dict:
    try:
        return submit_ocr_job_from_source(request.source, request.destination, request.recursive)
    except OCRError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = get_job_status(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/summary", response_model=OCRSummary)
def ocr_summary() -> OCRSummary:
    try:
        return get_summary()
    except OCRError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
