"""Background media-import jobs with preserve, remux, and transcode strategies."""

from __future__ import annotations

import logging
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Literal, TypedDict

from .encoder import EncodingCancelledError, normalize_video_fps, remux_video_for_browser
from .video_probe import VideoProbeMetadata, probe_video_metadata

logger = logging.getLogger("annotate_sidecar.normalization_jobs")

NormalizationJobStatus = Literal[
    "queued",
    "analyzing",
    "remuxing",
    "transcoding",
    "normalizing",
    "probing",
    "complete",
    "failed",
    "canceled",
]
ImportStrategy = Literal["preserve", "remux", "transcode"]


class NormalizationMetadata(TypedDict):
    fps: float
    fpsNumerator: int
    fpsDenominator: int
    frameCount: int
    width: int
    height: int
    durationMs: float
    frameCountSource: Literal["normalize", "probe"]
    importStrategy: ImportStrategy


@dataclass
class NormalizationJob:
    job_id: str
    temp_dir: Path
    input_path: Path
    output_path: Path
    target_fps: float | None = None
    target_width: int | None = None
    target_height: int | None = None
    result_path: Path | None = None
    status: NormalizationJobStatus = "queued"
    progress: float = 0.0
    error: str | None = None
    metadata: NormalizationMetadata | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    cancel_event: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None


_jobs: dict[str, NormalizationJob] = {}
_lock = threading.RLock()
_normalization_slot = threading.Semaphore(1)
_STALE_SECONDS = 60 * 60
_BROWSER_PIXEL_FORMATS = {"yuv420p", "yuvj420p"}


def _snapshot(job: NormalizationJob) -> dict:
    with _lock:
        return {
            "jobId": job.job_id,
            "status": job.status,
            "progress": job.progress,
            "error": job.error,
            "metadata": dict(job.metadata) if job.metadata else None,
        }


def _set_job_state(
    job: NormalizationJob,
    *,
    status: NormalizationJobStatus | None = None,
    progress: float | None = None,
    error: str | None = None,
    metadata: NormalizationMetadata | None = None,
) -> None:
    with _lock:
        if status is not None:
            job.status = status
            if status in {"analyzing", "remuxing", "transcoding", "normalizing", "probing"}:
                job.progress = 0.0
        if progress is not None:
            job.progress = max(job.progress, min(1.0, max(0.0, progress)))
        if error is not None:
            job.error = error
        if metadata is not None:
            job.metadata = metadata
        job.updated_at = time.time()


def _metadata(
    raw: VideoProbeMetadata | dict,
    *,
    frame_count_source: Literal["normalize", "probe"],
    strategy: ImportStrategy,
) -> NormalizationMetadata:
    fps = float(raw["fps"])
    fraction = Fraction(fps).limit_denominator(100_000)
    return {
        "fps": fps,
        "fpsNumerator": int(raw.get("fps_numerator") or fraction.numerator),
        "fpsDenominator": int(raw.get("fps_denominator") or fraction.denominator),
        "frameCount": int(raw["frame_count"]),
        "width": int(raw["width"]),
        "height": int(raw["height"]),
        "durationMs": float(raw["duration_ms"]),
        "frameCountSource": frame_count_source,
        "importStrategy": strategy,
    }


def _is_browser_video_stream(raw: VideoProbeMetadata) -> bool:
    return (
        raw["codec_name"] == "h264"
        and raw["pixel_format"] in _BROWSER_PIXEL_FORMATS
        and raw["constant_frame_rate"]
    )


def _is_directly_browser_playable(path: Path, raw: VideoProbeMetadata) -> bool:
    formats = set(raw["format_name"].split(","))
    return (
        path.suffix.lower() == ".mp4"
        and "mp4" in formats
        and _is_browser_video_stream(raw)
        and raw["audio_codec_name"] in {None, "aac", "mp3"}
    )


def _run_job(job: NormalizationJob) -> None:
    acquired_slot = False
    try:
        while not acquired_slot:
            if job.cancel_event.is_set():
                raise EncodingCancelledError("Video import was canceled")
            acquired_slot = _normalization_slot.acquire(timeout=0.2)

        _set_job_state(job, status="analyzing", progress=0.0)
        source = probe_video_metadata(str(job.input_path))
        _set_job_state(job, progress=1.0)
        if job.cancel_event.is_set():
            raise EncodingCancelledError("Video import was canceled")

        force_contract = all(value is not None for value in (
            job.target_fps,
            job.target_width,
            job.target_height,
        ))
        if force_contract:
            _set_job_state(job, status="normalizing", progress=0.0)
            normalize_video_fps(
                str(job.input_path),
                str(job.output_path),
                fps=float(job.target_fps),
                width=int(job.target_width),
                height=int(job.target_height),
                progress_callback=lambda value: _set_job_state(job, progress=value),
                cancel_event=job.cancel_event,
            )
            strategy: ImportStrategy = "transcode"
            frame_count_source: Literal["normalize", "probe"] = "normalize"
            result_path = job.output_path
        elif _is_directly_browser_playable(job.input_path, source):
            strategy = "preserve"
            frame_count_source = "probe"
            result_path = job.input_path
        elif _is_browser_video_stream(source):
            _set_job_state(job, status="remuxing", progress=0.0)
            remux_video_for_browser(
                str(job.input_path),
                str(job.output_path),
                audio_codec_name=source["audio_codec_name"],
                progress_callback=lambda value: _set_job_state(job, progress=value),
                cancel_event=job.cancel_event,
            )
            strategy = "remux"
            frame_count_source = "probe"
            result_path = job.output_path
        else:
            _set_job_state(job, status="transcoding", progress=0.0)
            normalize_video_fps(
                str(job.input_path),
                str(job.output_path),
                fps=source["fps"],
                width=source["width"],
                height=source["height"],
                progress_callback=lambda value: _set_job_state(job, progress=value),
                cancel_event=job.cancel_event,
            )
            strategy = "transcode"
            frame_count_source = "normalize"
            result_path = job.output_path

        if job.cancel_event.is_set():
            raise EncodingCancelledError("Video import was canceled")
        if result_path == job.input_path:
            result_metadata = source
        else:
            _set_job_state(job, status="probing", progress=0.0)
            result_metadata = probe_video_metadata(str(result_path))
            _set_job_state(job, progress=1.0)
        job.result_path = result_path
        metadata = _metadata(
            result_metadata,
            frame_count_source=frame_count_source,
            strategy=strategy,
        )
        _set_job_state(job, status="complete", progress=1.0, metadata=metadata)
        logger.info("Video import job %s complete (%s)", job.job_id, strategy)
    except EncodingCancelledError as error:
        _set_job_state(job, status="canceled", error=str(error))
        logger.info("Video import job %s canceled", job.job_id)
    except Exception as error:
        _set_job_state(job, status="failed", error=str(error))
        logger.exception("Video import job %s failed", job.job_id)
    finally:
        if acquired_slot:
            _normalization_slot.release()


def _cleanup_stale_jobs() -> None:
    cutoff = time.time() - _STALE_SECONDS
    with _lock:
        stale_ids = [
            job_id
            for job_id, job in _jobs.items()
            if job.status in {"complete", "failed", "canceled"} and job.updated_at < cutoff
        ]
    for job_id in stale_ids:
        cleanup_normalization_job(job_id)


def start_normalization_job(
    temp_dir: str | Path,
    input_path: str | Path,
    *,
    fps: float | None = None,
    width: int | None = None,
    height: int | None = None,
) -> dict:
    _cleanup_stale_jobs()
    job_id = uuid.uuid4().hex
    job = NormalizationJob(
        job_id=job_id,
        temp_dir=Path(temp_dir),
        input_path=Path(input_path),
        output_path=Path(temp_dir) / "prepared.mp4",
        target_fps=fps,
        target_width=width,
        target_height=height,
    )
    thread = threading.Thread(
        target=_run_job,
        args=(job,),
        name=f"annotate-import-{job_id[:8]}",
        daemon=True,
    )
    job.thread = thread
    with _lock:
        _jobs[job_id] = job
    thread.start()
    return _snapshot(job)


def get_normalization_job(job_id: str) -> dict | None:
    _cleanup_stale_jobs()
    with _lock:
        job = _jobs.get(job_id)
    return _snapshot(job) if job else None


def get_normalization_result(job_id: str) -> tuple[Path, NormalizationMetadata] | None:
    with _lock:
        job = _jobs.get(job_id)
        if not job or job.status != "complete" or not job.metadata or not job.result_path:
            return None
        return job.result_path, dict(job.metadata)


def cleanup_normalization_job(job_id: str) -> bool:
    with _lock:
        job = _jobs.pop(job_id, None)
    if not job:
        return False
    job.cancel_event.set()
    if job.thread and job.thread.is_alive() and job.thread is not threading.current_thread():
        job.thread.join(timeout=10)
    shutil.rmtree(job.temp_dir, ignore_errors=True)
    return True


def cleanup_normalization_jobs() -> None:
    with _lock:
        job_ids = list(_jobs)
    for job_id in job_ids:
        cleanup_normalization_job(job_id)
