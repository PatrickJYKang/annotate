"""Video registration routes for sidecar clip operations.

These routes let the browser upload a source clip video once and receive a
`videoRef` token that can be used by /track and /homography.
"""

import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services.encoder import normalize_video_fps
from ..services.normalization_jobs import (
    cleanup_normalization_job,
    get_normalization_job,
    get_normalization_result,
    start_normalization_job,
)
from ..services.video_probe import probe_video_metadata
from ..video_registry import register_video_path, unregister_video_ref

router = APIRouter()


async def _write_upload_to_path(file: UploadFile, destination: Path) -> int:
    size_bytes = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                output.write(chunk)
                size_bytes += len(chunk)
    finally:
        await file.close()
    return size_bytes


@router.post("/register")
async def register_video(file: UploadFile = File(...)):
    suffix = Path(file.filename or "video").suffix or ".mp4"
    with tempfile.NamedTemporaryFile(prefix="annotate_video_", suffix=suffix, delete=False) as temp_file:
        temp_path = Path(temp_file.name)
    video_ref: str | None = None
    try:
        size_bytes = await _write_upload_to_path(file, temp_path)
        if size_bytes <= 0:
            raise HTTPException(status_code=400, detail="Uploaded video file is empty")
        video_ref = register_video_path(temp_path)
        return {
            "videoRef": video_ref,
            "filename": file.filename,
            "sizeBytes": size_bytes,
        }
    except Exception:
        if video_ref is not None:
            unregister_video_ref(video_ref)
        else:
            temp_path.unlink(missing_ok=True)
        raise


@router.post("/normalize")
async def normalize_video(
    file: UploadFile = File(...),
    fps: float = Form(30.0),
    width: int = Form(1920),
    height: int = Form(1080),
):
    if fps <= 0:
        raise HTTPException(status_code=400, detail="fps must be positive")
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="width and height must be positive")

    tmp_dir = tempfile.mkdtemp(prefix="annotate_normalize_")
    try:
        suffix = Path(file.filename or "video").suffix or ".mp4"
        input_path = Path(tmp_dir) / f"source{suffix}"
        output_path = Path(tmp_dir) / "normalized.mp4"
        if await _write_upload_to_path(file, input_path) <= 0:
            raise HTTPException(status_code=400, detail="Uploaded video file is empty")

        result_path = normalize_video_fps(str(input_path), str(output_path), fps=fps, width=width, height=height)
        metadata = probe_video_metadata(result_path)
        return FileResponse(
            result_path,
            media_type="video/mp4",
            filename="normalized.mp4",
            headers={
                "X-Annotate-Frame-Count": str(metadata["frame_count"]),
                "X-Annotate-Fps": f'{metadata["fps"]:.12g}',
            },
            background=BackgroundTask(shutil.rmtree, tmp_dir, ignore_errors=True),
        )
    except HTTPException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    except FileNotFoundError as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=501, detail=str(e))
    except RuntimeError as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Video normalization failed: {e}")


@router.post("/normalize/start")
async def start_video_normalization(
    file: UploadFile = File(...),
    fps: float | None = Form(None),
    width: int | None = Form(None),
    height: int | None = Form(None),
):
    supplied_contract = [fps is not None, width is not None, height is not None]
    if any(supplied_contract) and not all(supplied_contract):
        raise HTTPException(status_code=400, detail="fps, width, and height must be supplied together")
    if fps is not None and fps <= 0:
        raise HTTPException(status_code=400, detail="fps must be positive")
    if width is not None and height is not None and (width <= 0 or height <= 0):
        raise HTTPException(status_code=400, detail="width and height must be positive")

    tmp_dir = tempfile.mkdtemp(prefix="annotate_normalize_job_")
    suffix = Path(file.filename or "video").suffix or ".mp4"
    input_path = Path(tmp_dir) / f"source{suffix}"
    try:
        if await _write_upload_to_path(file, input_path) <= 0:
            raise HTTPException(status_code=400, detail="Uploaded video file is empty")
        return start_normalization_job(
            tmp_dir,
            input_path,
            fps=fps,
            width=width,
            height=height,
        )
    except HTTPException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    except Exception as error:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail=f"Could not start video import: {error}",
        ) from error


@router.get("/normalize/{job_id}")
async def video_normalization_status(job_id: str):
    job = get_normalization_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Unknown normalization job: {job_id}")
    return job


@router.get("/normalize/{job_id}/file")
async def video_normalization_file(job_id: str):
    job = get_normalization_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Unknown normalization job: {job_id}")
    if job["status"] == "failed":
        raise HTTPException(status_code=500, detail=job["error"] or "Video import failed")
    if job["status"] == "canceled":
        raise HTTPException(status_code=409, detail=job["error"] or "Video import was canceled")

    result = get_normalization_result(job_id)
    if not result:
        raise HTTPException(status_code=409, detail="Video import is not complete")
    result_path, metadata = result
    return FileResponse(
        result_path,
        media_type="video/mp4",
        filename="prepared.mp4",
        headers={
            "X-Annotate-Frame-Count": str(metadata["frameCount"]),
            "X-Annotate-Fps": f'{metadata["fps"]:.12g}',
            "X-Annotate-Width": str(metadata["width"]),
            "X-Annotate-Height": str(metadata["height"]),
            "X-Annotate-Frame-Count-Source": metadata["frameCountSource"],
            "X-Annotate-Import-Strategy": metadata["importStrategy"],
        },
        background=BackgroundTask(cleanup_normalization_job, job_id),
    )


@router.delete("/normalize/{job_id}")
async def cancel_video_normalization(job_id: str):
    if not cleanup_normalization_job(job_id):
        raise HTTPException(status_code=404, detail=f"Unknown normalization job: {job_id}")
    return {"deleted": True}


@router.post("/probe")
async def probe_video(file: UploadFile = File(...)):
    tmp_dir = tempfile.mkdtemp(prefix="annotate_probe_")
    try:
        suffix = Path(file.filename or "video").suffix or ".mp4"
        input_path = Path(tmp_dir) / f"source{suffix}"
        if await _write_upload_to_path(file, input_path) <= 0:
            raise HTTPException(status_code=400, detail="Uploaded video file is empty")
        metadata = probe_video_metadata(str(input_path))
        return {
            "fps": metadata["fps"],
            "frameCount": metadata["frame_count"],
            "width": metadata["width"],
            "height": metadata["height"],
            "durationMs": metadata["duration_ms"],
        }
    except HTTPException:
        raise
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Video probe failed: {error}") from error
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@router.delete("/{video_ref}")
async def delete_video(video_ref: str):
    deleted = unregister_video_ref(video_ref)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Unknown videoRef: {video_ref}")
    return {"deleted": True}
