"""HTTP routes for approval checklist service."""

from __future__ import annotations

import logging
import mimetypes
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse

try:
    from pymongo.errors import PyMongoError
except ModuleNotFoundError:  # pragma: no cover - allow service to run without pymongo installed
    class PyMongoError(Exception):
        """Fallback error type when pymongo is unavailable."""

try:
    from ..schemas import (
        CheckCatalogResponse,
        DraftResponse,
        ExportPdfRequest,
        GenerateChecklistRequest,
        GenerateChecklistResponse,
        SaveDraftRequest,
    )
    from ..services.checklist_service import checklist_service
except ImportError:  # pragma: no cover - support `uvicorn app:app --app-dir backend/approval_checklist`
    from schemas import (
        CheckCatalogResponse,
        DraftResponse,
        ExportPdfRequest,
        GenerateChecklistRequest,
        GenerateChecklistResponse,
        SaveDraftRequest,
    )
    from services.checklist_service import checklist_service


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/approval-checklist", tags=["approval-checklist"])


@router.get("/checks", response_model=CheckCatalogResponse)
def list_supported_checks() -> CheckCatalogResponse:
    return CheckCatalogResponse(checks=checklist_service.get_check_catalog())


@router.post("/generate", response_model=GenerateChecklistResponse)
def generate_checklist(payload: GenerateChecklistRequest) -> GenerateChecklistResponse:
    try:
        result = checklist_service.generate_checklist(
            project_id=payload.project_id,
            model_path=payload.model_path,
            selected_check_ids=payload.selected_check_ids,
            observer_position=payload.observer_position.model_dump(),
            hemisphere_radius=payload.hemisphere_radius,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to generate checklist")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return GenerateChecklistResponse(**result)


@router.get("/runs/{run_id}/views/{view_name}")
def get_northeast_view(run_id: str, view_name: str) -> FileResponse:
    view_path = checklist_service.resolve_northeast_view_path(run_id=run_id, view_name=view_name)
    if view_path is None or not view_path.exists():
        raise HTTPException(status_code=404, detail="Northeast view not found")
    media_type = mimetypes.guess_type(view_path.name)[0] or "application/octet-stream"
    return FileResponse(path=view_path, media_type=media_type)


@router.post("/drafts", response_model=DraftResponse)
def save_draft(payload: SaveDraftRequest) -> DraftResponse:
    try:
        doc = checklist_service.save_draft(
            project_id=payload.project_id,
            checklist_payload=payload.checklist_payload,
            number=payload.number,
            plot_name=payload.plot_name,
            review_comment=payload.review_comment,
            conclusion=payload.conclusion,
        )
    except PyMongoError as exc:
        logger.exception("Failed to save draft")
        raise HTTPException(status_code=503, detail=f"MongoDB unavailable: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to save draft")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return DraftResponse(**doc)


@router.get("/drafts/{project_id}", response_model=DraftResponse)
def get_draft(project_id: str) -> DraftResponse:
    try:
        doc = checklist_service.get_draft(project_id)
    except PyMongoError as exc:
        logger.exception("Failed to load draft")
        raise HTTPException(status_code=503, detail=f"MongoDB unavailable: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to load draft")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not doc:
        raise HTTPException(status_code=404, detail=f"Draft not found for project_id={project_id}")
    return DraftResponse(**doc)


@router.post("/export-pdf")
def export_pdf(payload: ExportPdfRequest) -> Response:
    checklist_payload: dict[str, Any] | None = payload.checklist_payload
    project_id = payload.project_id
    if checklist_payload is None:
        if not project_id:
            raise HTTPException(status_code=400, detail="project_id or checklist_payload is required")
        draft = checklist_service.get_draft(project_id)
        if not draft:
            raise HTTPException(status_code=404, detail=f"Draft not found for project_id={project_id}")
        checklist_payload = draft.get("checklist_payload")
        if not isinstance(checklist_payload, dict):
            raise HTTPException(status_code=400, detail="Draft checklist_payload is empty")

    try:
        pdf_bytes = checklist_service.export_pdf(checklist_payload)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to export PDF")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    file_name = (payload.file_name or f"approval-checklist-{project_id or 'export'}.pdf").replace("\n", "")
    headers = {"Content-Disposition": f'attachment; filename="{file_name}"'}
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
