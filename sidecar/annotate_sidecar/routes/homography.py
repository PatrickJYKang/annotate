"""
Pitch homography estimation and progress streaming via trackers/PnLCalib.
"""

import logging
import asyncio
import json
from threading import Event
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional

from ..services.calibration.service import CalibrationService
from ..services.calibration.types import CalibrationFrameRange
from ..video_registry import resolve_video_ref

router = APIRouter()
logger = logging.getLogger("annotate_sidecar.routes.homography")

_service = CalibrationService()


class HomographyRequest(BaseModel):
    videoPath: Optional[str] = None
    videoRef: Optional[str] = None
    startMs: float = Field(ge=0, allow_inf_nan=False)
    endMs: float = Field(ge=0, allow_inf_nan=False)
    fps: float = Field(default=5.0, gt=0, le=120, allow_inf_nan=False)
    skipInterval: int = Field(default=0, ge=0, le=1000)

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


class FrameHomographyRequest(BaseModel):
    videoPath: Optional[str] = None
    videoRef: Optional[str] = None
    startFrame: int = Field(ge=0, strict=True)
    endFrame: int = Field(gt=0, strict=True)
    sourceFps: float = Field(gt=0, le=240, allow_inf_nan=False)
    everyNFrames: int = Field(default=15, ge=1, le=300, strict=True)

    @model_validator(mode='after')
    def validate_range(self):
        if not self.videoRef and not self.videoPath:
            raise ValueError('Either videoRef or videoPath is required')
        if self.endFrame <= self.startFrame:
            raise ValueError('endFrame is exclusive and must be greater than startFrame')
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
def estimate_homography(req: HomographyRequest):
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


@router.post('/stream')
async def stream_homography(req: FrameHomographyRequest | HomographyRequest):
    video_path = _resolve_video_path(req.videoRef, req.videoPath)
    if not _service.available:
        raise HTTPException(status_code=501, detail='PnLCalib is unavailable. Check the provider installation.')

    async def events():
        queue: asyncio.Queue = asyncio.Queue()
        canceled = Event()
        loop = asyncio.get_running_loop()

        class Canceled(Exception):
            pass

        def emit(event):
            if canceled.is_set():
                raise Canceled()
            loop.call_soon_threadsafe(queue.put_nowait, event)

        def work():
            try:
                if isinstance(req, FrameHomographyRequest):
                    options = {
                        'start_ms': req.startFrame * 1000 / req.sourceFps,
                        'end_ms': (req.endFrame - 1) * 1000 / req.sourceFps,
                        'frame_range': CalibrationFrameRange(req.startFrame, req.endFrame, req.sourceFps, req.everyNFrames),
                    }
                else:
                    options = {'start_ms': req.startMs, 'end_ms': req.endMs, 'fps': req.fps, 'skip_interval': req.skipInterval}
                frames = _service.estimate_range(
                    video_path=video_path, **options,
                    on_progress=lambda progress: emit({'type': 'progress', **progress}),
                )
                emit({'type': 'result', 'result': {'frames': [
                    {'tMs': frame.tMs, 'matrix': frame.matrix, 'method': frame.method} for frame in frames
                ]}})
            except Canceled:
                pass
            except Exception as error:
                logger.exception('Homography computation failed')
                if not canceled.is_set():
                    emit({'type': 'error', 'message': str(error)})

        task = asyncio.create_task(asyncio.to_thread(work))
        try:
            yield json.dumps({'type': 'progress', 'phase': 'queued', 'completed': 0, 'total': 0}) + '\n'
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=5)
                except asyncio.TimeoutError:
                    yield '\n'
                    continue
                yield json.dumps(event, separators=(',', ':')) + '\n'
                if event['type'] in ('result', 'error'):
                    break
        finally:
            canceled.set()
            # The CPU/GPU worker exits at its next checkpoint; do not block the
            # ASGI disconnect path or pretend canceling a Task kills a thread.
            task.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)

    return StreamingResponse(events(), media_type='application/x-ndjson', headers={'Cache-Control': 'no-store'})
