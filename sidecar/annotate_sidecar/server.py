"""
FastAPI application for the annotate sidecar.

Provides ML-powered features: object tracking, segmentation,
homography estimation, and export encoding.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .routes import health, track, segment, homography, export
from .project_root import set_project_root, get_project_root

logger = logging.getLogger("annotate_sidecar")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown events."""
    # --- Startup ---
    logger.info("annotate_sidecar starting up")

    # Check model availability
    from .routes.health import _check_capabilities

    caps = _check_capabilities()
    models = caps.get("models", {})
    available = [k for k, v in models.items() if v]
    missing = [k for k, v in models.items() if not v]
    if available:
        logger.info("Models available: %s", ", ".join(available))
    if missing:
        logger.info("Models NOT available: %s", ", ".join(missing))
    logger.info("Capabilities: %s", caps.get("capabilities", []))

    yield

    # --- Shutdown ---
    # Close cached VideoCapture objects
    from .services.frame_extractor import close_all_captures

    close_all_captures()
    logger.info("annotate_sidecar shut down")


class ProjectRootRequest(BaseModel):
    projectRoot: str


def create_app(project_root: Optional[str] = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="annotate-sidecar",
        description="ML sidecar for the annotate tool",
        version="0.1.0",
        lifespan=lifespan,
    )
    if project_root:
        set_project_root(project_root)
        logger.info("Project root: %s", project_root)

    # CORS — allow the Next.js dev server and any localhost origin
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:3001",
        ],
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # --- Project root endpoint ---
    @app.post("/project-root")
    async def post_project_root(body: ProjectRootRequest):
        root = body.projectRoot
        if not Path(root).is_dir():
            raise HTTPException(400, f"Not a valid directory: {root}")
        set_project_root(root)
        logger.info("Project root set to: %s", root)
        return {"projectRoot": root}

    @app.get("/project-root")
    async def get_project_root_endpoint():
        return {"projectRoot": get_project_root()}

    # Mount route modules
    app.include_router(health.router, tags=["health"])
    app.include_router(track.router, prefix="/track", tags=["tracking"])
    app.include_router(segment.router, prefix="/segment", tags=["segmentation"])
    app.include_router(homography.router, prefix="/homography", tags=["homography"])
    app.include_router(export.router, prefix="/export", tags=["export"])

    return app
