"""
FastAPI application for the annotate sidecar.

Provides ML-powered object tracking, homography estimation, and export encoding.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import derived_media, health, track, homography, export, video
from .video_registry import cleanup_registered_videos

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
    from .services.normalization_jobs import cleanup_normalization_jobs

    close_all_captures()
    cleanup_normalization_jobs()
    cleanup_registered_videos()
    logger.info("annotate_sidecar shut down")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="annotate-sidecar",
        description="ML sidecar for the annotate tool",
        version="0.2.2",
        lifespan=lifespan,
    )

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
        expose_headers=[
            "X-Annotate-Frame-Count",
            "X-Annotate-Fps",
            "X-Annotate-Width",
            "X-Annotate-Height",
            "X-Annotate-Frame-Count-Source",
            "X-Annotate-Import-Strategy",
        ],
    )

    # Mount route modules
    app.include_router(health.router, tags=["health"])
    app.include_router(track.router, prefix="/track", tags=["tracking"])
    app.include_router(homography.router, prefix="/homography", tags=["homography"])
    app.include_router(export.router, prefix="/export", tags=["export"])
    app.include_router(derived_media.router, prefix="/derived-media", tags=["derived-media"])
    app.include_router(video.router, prefix="/video", tags=["video"])

    return app
