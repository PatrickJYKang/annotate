import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator, model_validator
from starlette.background import BackgroundTask

from ..services.encoder import (
    check_ffmpeg,
    encode_exact_motion_segment,
)
from ..video_registry import resolve_video_ref

router = APIRouter()
logger = logging.getLogger("annotate_sidecar.derived_media")


class DerivedMediaVideoRequest(BaseModel):
    videoPath: Optional[str] = None
    videoRef: Optional[str] = None

    @model_validator(mode='after')
    def validate_video_locator(self):
        if not self.videoRef and not self.videoPath:
            raise ValueError('Either videoRef or videoPath is required')
        return self


class ExactMotionEncodeRequest(DerivedMediaVideoRequest):
    startMs: float
    endMs: float

    @field_validator('startMs', 'endMs')
    @classmethod
    def non_negative_ms(cls, value: float) -> float:
        if value < 0:
            raise ValueError('Timestamps must be >= 0')
        return value

    @model_validator(mode='after')
    def validate_request(self):
        if self.endMs <= self.startMs:
            raise ValueError('endMs must be greater than startMs')
        return self


def _resolve_video_path(video_ref: Optional[str], video_path_arg: Optional[str]) -> str:
    video_path = resolve_video_ref(video_ref)
    if video_ref and not video_path and not video_path_arg:
        raise HTTPException(status_code=404, detail=f'Unknown videoRef: {video_ref}')
    if not video_path and video_path_arg:
        if not Path(video_path_arg).is_absolute():
            raise HTTPException(
                status_code=400,
                detail='Relative videoPath is unsupported. Register the file via /video/register or use an absolute path.',
            )
        video_path = video_path_arg
    if not video_path:
        raise HTTPException(status_code=404, detail='Video not found')
    if not Path(video_path).is_file():
        raise HTTPException(status_code=404, detail=f'Video not found: {video_path}')
    return video_path


def _cleanup_temp_file(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def _derived_media_ffmpeg_unavailable_error() -> HTTPException:
    return HTTPException(
        status_code=501,
        detail='ffmpeg not found on PATH. Install ffmpeg to enable derived-media encoding.',
    )


def _redact_video_path_for_log(video_path: Optional[str]) -> Optional[str]:
    if not video_path:
        return None
    try:
        path = Path(video_path)
        return str(path)
    except Exception:
        return video_path


@router.post('/exact-motion')
async def encode_exact_motion(req: ExactMotionEncodeRequest):
    logger.info(
        "Received exact-motion encode request videoRef=%s videoPath=%s startMs=%.1f endMs=%.1f",
        req.videoRef,
        _redact_video_path_for_log(req.videoPath),
        req.startMs,
        req.endMs,
    )
    if not check_ffmpeg():
        logger.error("Rejecting exact-motion encode request because ffmpeg is unavailable")
        raise _derived_media_ffmpeg_unavailable_error()

    video_path = _resolve_video_path(req.videoRef, req.videoPath)
    logger.info("Resolved exact-motion source path: %s", _redact_video_path_for_log(video_path))

    with tempfile.NamedTemporaryFile(prefix='annotate_exact_motion_', suffix='.mp4', delete=False) as tmp:
        output_path = tmp.name
    logger.info("Allocated exact-motion temp output: %s", output_path)

    try:
        result_path = encode_exact_motion_segment(
            video_path=video_path,
            output_path=output_path,
            start_ms=req.startMs,
            end_ms=req.endMs,
        )
    except FileNotFoundError as error:
        _cleanup_temp_file(output_path)
        logger.warning("Exact-motion encode failed with missing file: %s", error)
        raise HTTPException(status_code=404, detail=str(error))
    except ValueError as error:
        _cleanup_temp_file(output_path)
        logger.warning("Exact-motion encode rejected invalid request: %s", error)
        raise HTTPException(status_code=400, detail=str(error))
    except RuntimeError as error:
        _cleanup_temp_file(output_path)
        logger.error("Exact-motion encode failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
    except Exception as error:
        _cleanup_temp_file(output_path)
        logger.exception("Unexpected exact-motion encode failure")
        raise HTTPException(status_code=500, detail=f"Unexpected exact-motion encode failure: {error}")

    logger.info(
        "Serving exact-motion output %s (%s bytes)",
        result_path,
        Path(result_path).stat().st_size if Path(result_path).exists() else "missing",
    )

    return FileResponse(
        result_path,
        media_type='video/mp4',
        filename=Path(result_path).name,
        background=BackgroundTask(_cleanup_temp_file, result_path),
    )
