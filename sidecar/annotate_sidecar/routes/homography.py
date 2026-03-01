"""
POST /homography — pitch homography estimation (Narya).

Accepts a video path and time range, returns per-frame homography matrices
with temporal smoothing applied.
"""

import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from ..services.homography_estimator import HomographyEstimator
from ..project_root import resolve_video_path

router = APIRouter()
logger = logging.getLogger("annotate_sidecar.routes.homography")

_estimator = HomographyEstimator()


class HomographyRequest(BaseModel):
    videoPath: str
    startMs: float
    endMs: float
    fps: float = 5.0
    skipInterval: int = 0

    @field_validator("endMs")
    @classmethod
    def end_after_start(cls, v: float, info) -> float:
        start = info.data.get("startMs")
        if start is not None and v <= start:
            raise ValueError("endMs must be greater than startMs")
        return v


@router.post("")
async def estimate_homography(req: HomographyRequest):
    """Estimate pitch homography for a video range."""
    video_path = resolve_video_path(req.videoPath)
    if not Path(video_path).exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

    if not _estimator.available:
        raise HTTPException(
            status_code=501,
            detail="Narya is not installed. Homography estimation unavailable.",
        )

    try:
        frames = _estimator.estimate_range(
            video_path=video_path,
            start_ms=req.startMs,
            end_ms=req.endMs,
            fps=req.fps,
            skip_interval=req.skipInterval,
        )

        return {
            "frames": [
                {
                    "tMs": f.tMs,
                    "matrix": f.matrix,
                    "method": f.method,
                }
                for f in frames
            ],
        }

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
