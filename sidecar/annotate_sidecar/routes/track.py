"""
POST /track — object tracking (YOLO + trackers-backed OC-SORT).

Accepts a video path, time range, and seed bounding box.
Returns tracked keyframes with absolute video-ms timestamps.
"""

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator, model_validator

from ..config import get_tracking_defaults
from ..services.tracker import Tracker, BBox
from ..video_registry import resolve_video_ref

router = APIRouter()
logger = logging.getLogger("annotate_sidecar.routes.track")

# Singleton tracker instance (lazy model load)
_tracker = Tracker()


class TrackRequest(BaseModel):
    videoPath: Optional[str] = None
    videoRef: Optional[str] = None
    startMs: float
    endMs: float
    seedBbox: dict  # { x, y, w, h }
    seedFrameMs: float
    fps: Optional[float] = None
    classes: Optional[list[int]] = None
    confThreshold: Optional[float] = None
    iouThreshold: Optional[float] = None

    @field_validator("endMs")
    @classmethod
    def end_after_start(cls, v: float, info) -> float:
        start = info.data.get("startMs")
        if start is not None and v <= start:
            raise ValueError("endMs must be greater than startMs")
        return v

    @field_validator("seedBbox")
    @classmethod
    def bbox_valid(cls, v: dict) -> dict:
        for key in ("x", "y", "w", "h"):
            if key not in v:
                raise ValueError(f"seedBbox missing required key: {key}")
        if v.get("w", 0) <= 0 or v.get("h", 0) <= 0:
            raise ValueError("seedBbox must have positive width and height")
        return v

    @model_validator(mode="after")
    def require_video_locator(self):
        if not self.videoRef and not self.videoPath:
            raise ValueError("Either videoRef or videoPath is required")
        return self


@router.post("")
async def track(req: TrackRequest):
    """Track an object across a video range."""
    defaults = get_tracking_defaults()
    # Resolve from uploaded ref first, then fall back to direct absolute path.
    video_path = resolve_video_ref(req.videoRef)
    if req.videoRef and not video_path and not req.videoPath:
        raise HTTPException(status_code=404, detail=f"Unknown videoRef: {req.videoRef}")
    if not video_path and req.videoPath:
        if not Path(req.videoPath).is_absolute():
            raise HTTPException(
                status_code=400,
                detail="Relative videoPath is unsupported. Register the file via /video/register or use an absolute path.",
            )
        video_path = req.videoPath

    if not video_path or not Path(video_path).exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

    seed = BBox(
        x=req.seedBbox["x"],
        y=req.seedBbox["y"],
        w=req.seedBbox["w"],
        h=req.seedBbox["h"],
    )

    # Validate seedFrameMs is within range
    if not (req.startMs <= req.seedFrameMs <= req.endMs):
        raise HTTPException(
            status_code=422,
            detail="seedFrameMs must be within [startMs, endMs]",
        )

    try:
        result = _tracker.track_range(
            video_path=video_path,
            start_ms=req.startMs,
            end_ms=req.endMs,
            seed_bbox=seed,
            seed_frame_ms=req.seedFrameMs,
            fps=req.fps if req.fps is not None else defaults.sample_fps,
            classes=req.classes if req.classes is not None else list(defaults.classes),
            conf_threshold=req.confThreshold if req.confThreshold is not None else defaults.conf_threshold,
            iou_threshold=req.iouThreshold if req.iouThreshold is not None else defaults.iou_threshold,
            track_buffer=defaults.track_buffer_frames,
        )
        return result

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except ValueError as e:
        # No matching detection — include detected bboxes if available
        args = e.args
        detail: dict = {"message": str(args[0]) if args else "No matching detection"}
        if len(args) > 1 and isinstance(args[1], list):
            detail["detectedBboxes"] = args[1]
        raise HTTPException(status_code=422, detail=detail)

    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        if isinstance(e, ModuleNotFoundError) and getattr(e, "name", "") == "supervision":
            raise HTTPException(
                status_code=501,
                detail="Tracking dependency missing: supervision. Install inside sidecar venv with `.venv/bin/pip install supervision>=0.26.1` and restart the sidecar.",
            )
        logger.exception("Unexpected tracking failure")
        raise HTTPException(status_code=500, detail=f"Tracking failed: {e}")
