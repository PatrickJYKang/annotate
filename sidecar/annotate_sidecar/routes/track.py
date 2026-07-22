"""
POST /track — object tracking (YOLO + trackers-backed OC-SORT).

Accepts a video path, time range, and seed bounding box.
Returns tracked keyframes with absolute video-ms timestamps.
"""

import json
import logging
from pathlib import Path
from queue import Queue
from threading import Thread
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, field_validator, model_validator

from ..config import get_tracking_defaults
from ..services.frame_extractor import extract_frame
from ..services.tracker import Tracker, BBox
from ..services.tracking_debug import resolve_tracking_debug_artifact
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
    debugVideo: bool = False
    stopOnLoss: bool = False

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


class DetectPlayersRequest(BaseModel):
    videoPath: Optional[str] = None
    videoRef: Optional[str] = None
    frameMs: float
    classes: Optional[list[int]] = None
    confThreshold: Optional[float] = None

    @field_validator("frameMs")
    @classmethod
    def frame_ms_non_negative(cls, value: float) -> float:
        if value < 0:
            raise ValueError("frameMs must be >= 0")
        return value

    @model_validator(mode="after")
    def require_video_locator(self):
        if not self.videoRef and not self.videoPath:
            raise ValueError("Either videoRef or videoPath is required")
        return self


def _resolve_video_path(video_ref: Optional[str], direct_path: Optional[str]) -> str:
    video_path = resolve_video_ref(video_ref)
    if video_ref and not video_path and not direct_path:
        raise HTTPException(status_code=404, detail=f"Unknown videoRef: {video_ref}")
    if not video_path and direct_path:
        if not Path(direct_path).is_absolute():
            raise HTTPException(
                status_code=400,
                detail="Relative videoPath is unsupported. Register the file via /video/register or use an absolute path.",
            )
        video_path = direct_path

    if not video_path or not Path(video_path).exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")
    return video_path


def _value_error_detail(error: ValueError) -> dict:
    args = error.args
    detail: dict = {"message": str(args[0]) if args else "No matching detection"}
    if len(args) > 1 and isinstance(args[1], list):
        detail["detectedBboxes"] = args[1]
    if len(args) > 2 and isinstance(args[2], dict):
        detail.update(args[2])
    debug_path = detail.get("debugVideoPath")
    if isinstance(debug_path, str) and debug_path:
        detail["debugVideoUrl"] = f"/track/debug/{Path(debug_path).name}"
    return detail


def _decorate_tracking_result(result: dict) -> dict:
    debug_path = result.get("debugVideoPath")
    if isinstance(debug_path, str) and debug_path:
        result["debugVideoUrl"] = f"/track/debug/{Path(debug_path).name}"
    return result


@router.post("/detect")
async def detect_players(req: DetectPlayersRequest):
    """Detect every player at one frame for interactive target selection."""
    defaults = get_tracking_defaults()
    video_path = _resolve_video_path(req.videoRef, req.videoPath)
    try:
        frame = extract_frame(video_path, req.frameMs)
        detections = _tracker.detect_frame(
            frame,
            classes=req.classes if req.classes is not None else list(defaults.classes),
            conf_threshold=req.confThreshold if req.confThreshold is not None else defaults.conf_threshold,
        )
        return {
            "frameMs": req.frameMs,
            "detections": [
                {
                    "x": detection.x,
                    "y": detection.y,
                    "w": detection.w,
                    "h": detection.h,
                    "confidence": detection.confidence,
                }
                for detection in detections
            ],
        }
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error))
    except Exception as error:
        logger.exception("Unexpected player detection failure")
        raise HTTPException(status_code=500, detail=f"Player detection failed: {error}")


@router.post("")
async def track(req: TrackRequest):
    """Track an object across a video range."""
    defaults = get_tracking_defaults()
    video_path = _resolve_video_path(req.videoRef, req.videoPath)

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
            debug_video=req.debugVideo,
            stop_on_loss=req.stopOnLoss,
        )
        return _decorate_tracking_result(result)

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    except ValueError as e:
        # No matching detection — include detected bboxes if available
        raise HTTPException(status_code=422, detail=_value_error_detail(e))

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


@router.post("/stream")
async def track_stream(req: TrackRequest):
    """Stream trusted keyframes while preserving the final /track response shape."""
    defaults = get_tracking_defaults()
    video_path = _resolve_video_path(req.videoRef, req.videoPath)
    seed = BBox(
        x=req.seedBbox["x"],
        y=req.seedBbox["y"],
        w=req.seedBbox["w"],
        h=req.seedBbox["h"],
    )
    if not (req.startMs <= req.seedFrameMs <= req.endMs):
        raise HTTPException(status_code=422, detail="seedFrameMs must be within [startMs, endMs]")

    def events():
        queue: Queue[Optional[dict]] = Queue()

        def emit_keyframe(keyframe: dict) -> None:
            queue.put({"type": "keyframe", "keyframe": keyframe})

        def run_tracking() -> None:
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
                    debug_video=req.debugVideo,
                    stop_on_loss=req.stopOnLoss,
                    progress_callback=emit_keyframe,
                )
                queue.put({"type": "result", "result": _decorate_tracking_result(result)})
            except ValueError as error:
                queue.put({"type": "error", "error": _value_error_detail(error)})
            except FileNotFoundError as error:
                queue.put({"type": "error", "error": {"message": str(error)}})
            except RuntimeError as error:
                queue.put({"type": "error", "error": {"message": str(error)}})
            except Exception as error:
                if isinstance(error, ModuleNotFoundError) and getattr(error, "name", "") == "supervision":
                    message = "Tracking dependency missing: supervision. Install inside sidecar venv and restart the sidecar."
                else:
                    logger.exception("Unexpected streaming tracking failure")
                    message = f"Tracking failed: {error}"
                queue.put({"type": "error", "error": {"message": message}})
            finally:
                queue.put(None)

        Thread(target=run_tracking, daemon=True, name="annotate-tracking-stream").start()
        while True:
            event = queue.get()
            if event is None:
                break
            yield json.dumps(event, separators=(",", ":")) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


@router.get("/debug/{artifact_name}")
async def get_tracking_debug_video(artifact_name: str):
    artifact = resolve_tracking_debug_artifact(artifact_name)
    if artifact is None:
        raise HTTPException(status_code=404, detail=f"Unknown tracking debug artifact: {artifact_name}")
    return FileResponse(str(artifact), media_type="video/mp4", filename=artifact.name)
