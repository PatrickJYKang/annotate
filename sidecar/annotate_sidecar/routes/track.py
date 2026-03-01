"""
POST /track — object tracking (YOLO + ByteTrack).

Accepts a video path, time range, and seed bounding box.
Returns tracked keyframes with absolute video-ms timestamps.
"""

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from ..services.tracker import Tracker, BBox
from ..project_root import resolve_video_path

router = APIRouter()
logger = logging.getLogger("annotate_sidecar.routes.track")

# Singleton tracker instance (lazy model load)
_tracker = Tracker()


class TrackRequest(BaseModel):
    videoPath: str
    startMs: float
    endMs: float
    seedBbox: dict  # { x, y, w, h }
    seedFrameMs: float
    fps: float = 30.0
    classes: Optional[list[int]] = None
    confThreshold: float = 0.25
    iouThreshold: float = 0.3

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


@router.post("")
async def track(req: TrackRequest):
    """Track an object across a video range."""
    # Resolve relative video path against project root
    video_path = resolve_video_path(req.videoPath)
    if not Path(video_path).exists():
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
            fps=req.fps,
            classes=req.classes,
            conf_threshold=req.confThreshold,
            iou_threshold=req.iouThreshold,
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
