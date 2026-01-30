from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from rhino_api.api.models import router as models_router
from rhino_api.api.height_check import router as height_check_router
from rhino_api.api.sight_corridor import router as sight_corridor_router
from rhino_api.core import config

app = FastAPI(title="HDMS Rhino Model API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=config.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(models_router)
app.include_router(height_check_router)
app.include_router(sight_corridor_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
