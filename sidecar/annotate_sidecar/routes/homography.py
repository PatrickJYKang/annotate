"""
POST /homography — pitch homography estimation via trackers/PnLCalib.
"""

import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional

from ..services.calibration.service import CalibrationService
from ..video_registry import resolve_video_ref

router = APIRouter()
logger = logging.getLogger("annotate_sidecar.routes.homography")

_service = CalibrationService()


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

    if not _service.available:
        raise HTTPException(
            status_code=501,
            detail="OpenCV is not installed. Homography estimation unavailable.",
        )

    try:
        frames = _service.estimate_range(
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
