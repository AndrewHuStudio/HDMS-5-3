"""Pydantic schemas for approval checklist APIs."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ObserverPosition(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 1.7


class GenerateChecklistRequest(BaseModel):
    project_id: str = Field(..., min_length=1, description="Business project id")
    model_path: str = Field(..., min_length=1, description="3dm model path in review_system")
    selected_check_ids: list[str] | None = Field(
        default=None,
        description="Optional subset of checks to include; defaults to all checks",
    )
    observer_position: ObserverPosition = Field(default_factory=ObserverPosition)
    hemisphere_radius: float = Field(default=100.0, gt=0)


class GenerateChecklistResponse(BaseModel):
    run_id: str
    run_dir: str
    payload: dict[str, Any]


class CheckCatalogItem(BaseModel):
    check_id: str
    check_name: str
    default_selected: bool = True


class CheckCatalogResponse(BaseModel):
    checks: list[CheckCatalogItem]


class SaveDraftRequest(BaseModel):
    project_id: str = Field(..., min_length=1)
    checklist_payload: dict[str, Any]
    number: str = ""
    plot_name: str = "未命名片区"
    review_comment: str = ""
    conclusion: str = ""


class DraftResponse(BaseModel):
    project_id: str
    checklist_payload: dict[str, Any]
    number: str = ""
    plot_name: str = "未命名片区"
    review_comment: str = ""
    conclusion: str = ""
    created_at: str | None = None
    updated_at: str


class ExportPdfRequest(BaseModel):
    project_id: str | None = None
    checklist_payload: dict[str, Any] | None = None
    file_name: str | None = None

