from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(
    title="HDMS Approval Checklist API",
    docs_url="/approval/docs",
    openapi_url="/approval/openapi.json",
)


@app.get("/approval")
def root() -> dict:
    return {"status": "ok", "service": "approval_checklist"}


@app.get("/approval/health")
def health() -> dict:
    return {"status": "ok"}
