from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core import config
from routes import (
    fire_ladder,
    green_setback_check,
    height_check,
    models,
    plaza_setback_check,
    setback_check,
    setback_rate_check,
    sight_corridor,
    sky_bridge,
    vehicle_entrance_check,
)

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
app.include_router(green_setback_check.router)
app.include_router(plaza_setback_check.router)
app.include_router(setback_rate_check.router)
app.include_router(vehicle_entrance_check.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
