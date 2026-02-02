from importlib import import_module
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from rhino_api.core import config

logger = logging.getLogger(__name__)

app = FastAPI(title="HDMS Rhino Model API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=config.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

features_dir = Path(__file__).parent / "features"
if features_dir.exists():
    for feature_dir in features_dir.iterdir():
        if not feature_dir.is_dir():
            continue
        api_file = feature_dir / "api.py"
        if not api_file.exists():
            continue

        module_name = f"rhino_api.features.{feature_dir.name}.api"
        try:
            module = import_module(module_name)
        except Exception as exc:
            logger.exception("Failed to import feature module %s: %s", module_name, exc)
            continue

        router = getattr(module, "router", None)
        if router is None:
            logger.warning("Feature module %s has no router", module_name)
            continue

        app.include_router(router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
