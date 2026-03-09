"""
POST /homography — pitch homography estimation.

Accepts a video path and time range, returns per-frame homography matrices
without temporal interpolation.
"""

import logging
import math
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional

from ..services.homography_estimator import HomographyEstimator
from ..video_registry import resolve_video_ref

router = APIRouter()
logger = logging.getLogger("annotate_sidecar.routes.homography")

_estimator = HomographyEstimator()


class HomographyRequest(BaseModel):
    videoPath: Optional[str] = None
    videoRef: Optional[str] = None
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

    @model_validator(mode="after")
    def require_video_locator(self):
        if not self.videoRef and not self.videoPath:
            raise ValueError("Either videoRef or videoPath is required")
        return self


class ManualTrackHomographyRequest(BaseModel):
    videoPath: Optional[str] = None
    videoRef: Optional[str] = None
    startMs: float
    endMs: float
    seedMs: float
    seedMatrix: list[float]
    fps: float = 5.0
    skipInterval: int = 0

    @field_validator("endMs")
    @classmethod
    def end_after_start(cls, v: float, info) -> float:
        start = info.data.get("startMs")
        if start is not None and v <= start:
            raise ValueError("endMs must be greater than startMs")
        return v

    @field_validator("seedMatrix")
    @classmethod
    def validate_seed_matrix(cls, v: list[float]) -> list[float]:
        if len(v) != 9:
            raise ValueError("seedMatrix must have exactly 9 values")
        if not all(isinstance(x, (int, float)) and math.isfinite(float(x)) for x in v):
            raise ValueError("seedMatrix must contain finite numeric values")
        return [float(x) for x in v]

    @model_validator(mode="after")
    def validate_request(self):
        if not self.videoRef and not self.videoPath:
            raise ValueError("Either videoRef or videoPath is required")
        if self.seedMs < self.startMs or self.seedMs > self.endMs:
            raise ValueError("seedMs must be inside [startMs, endMs]")
        return self


def _resolve_video_path(video_ref: Optional[str], video_path_arg: Optional[str]) -> str:
    video_path = resolve_video_ref(video_ref)
    if video_ref and not video_path and not video_path_arg:
        raise HTTPException(status_code=404, detail=f"Unknown videoRef: {video_ref}")
    if not video_path and video_path_arg:
        if not Path(video_path_arg).is_absolute():
            raise HTTPException(
                status_code=400,
                detail="Relative videoPath is unsupported. Register the file via /video/register or use an absolute path.",
            )
        video_path = video_path_arg

    if not video_path or not Path(video_path).exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")
    return video_path


@router.post("")
async def estimate_homography(req: HomographyRequest):
    """Estimate pitch homography for a video range."""
    video_path = _resolve_video_path(req.videoRef, req.videoPath)

    if not _estimator.available:
        raise HTTPException(
            status_code=501,
            detail="OpenCV is not installed. Homography estimation unavailable.",
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


@router.post("/manual-track")
async def estimate_homography_from_manual_seed(req: ManualTrackHomographyRequest):
    """Track homography across a clip from one manual seed homography."""
    video_path = _resolve_video_path(req.videoRef, req.videoPath)

    if not _estimator.available:
        raise HTTPException(
            status_code=501,
            detail="OpenCV is not installed. Homography estimation unavailable.",
        )

    try:
        frames = _estimator.estimate_range_from_seed_homography(
            video_path=video_path,
            start_ms=req.startMs,
            end_ms=req.endMs,
            seed_ms=req.seedMs,
            seed_matrix=req.seedMatrix,
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
