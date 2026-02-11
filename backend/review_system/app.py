from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core import config
from routes import fire_ladder, height_check, models, setback_check, sight_corridor, sky_bridge

logger = logging.getLogger(__name__)

app = FastAPI(title="HDMS Review System API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=config.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(models.router)
app.include_router(height_check.router)
app.include_router(setback_check.router)
app.include_router(sight_corridor.router)
app.include_router(fire_ladder.router)
app.include_router(sky_bridge.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
