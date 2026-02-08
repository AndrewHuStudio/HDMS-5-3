from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from data_process.core import config
from data_process.core.database.manager import db_manager
from data_process.KG_process.graph.api import router as graph_router
from data_process.vector_process.ingestion.api import router as ingestion_router

logger = logging.getLogger(__name__)

app = FastAPI(title="HDMS Data Process API")


async def _init_databases() -> None:
    try:
        logger.info("Initializing database connections...")
        await asyncio.to_thread(db_manager.initialize)
        logger.info("Database connections initialized successfully")
    except Exception as exc:
        logger.error("Failed to initialize databases: %s", exc)
        logger.warning("Application will continue without database connections")


@app.on_event("startup")
async def startup_event():
    """Initialize database connections on startup."""
    if not config.DB_INIT_ON_STARTUP:
        logger.info("Database initialization disabled via DB_INIT_ON_STARTUP")
        return
    if config.DB_INIT_ASYNC:
        logger.info("Starting database initialization in background")
        asyncio.create_task(_init_databases())
        return
    await _init_databases()


@app.on_event("shutdown")
async def shutdown_event():
    """Close database connections on shutdown."""
    logger.info("Closing database connections...")
    db_manager.cleanup()
    logger.info("Database connections closed")


app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=config.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingestion_router)
app.include_router(graph_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/health/db")
def health_db() -> dict:
    """Get database health and statistics."""
    try:
        stats = db_manager.get_stats()
        return {"status": "ok", "databases": stats}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}
