"""FastAPI app for approval checklist service."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    from .core import config
    from .routes import router as checklist_router
except ImportError:  # pragma: no cover - support `uvicorn app:app --app-dir backend/approval_checklist`
    from core import config
    from routes import router as checklist_router


app = FastAPI(title="HDMS Approval Checklist API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=config.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(checklist_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
