"""Video registration routes for sidecar clip operations.

These routes let the browser upload a source clip video once and receive a
`videoRef` token that can be used by /track, /segment, and /homography.
"""

import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..services.encoder import normalize_video_fps
from ..video_registry import register_video_file, unregister_video_ref

router = APIRouter()


@router.post("/register")
async def register_video(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded video file is empty")

    video_ref = register_video_file(file.filename, data)
    return {
        "videoRef": video_ref,
        "filename": file.filename,
        "sizeBytes": len(data),
    }


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
        input_path.write_bytes(await file.read())
        if input_path.stat().st_size <= 0:
            raise HTTPException(status_code=400, detail="Uploaded video file is empty")

        result_path = normalize_video_fps(str(input_path), str(output_path), fps=fps, width=width, height=height)
        return FileResponse(
            result_path,
            media_type="video/mp4",
            filename="normalized.mp4",
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


@router.delete("/{video_ref}")
async def delete_video(video_ref: str):
    deleted = unregister_video_ref(video_ref)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Unknown videoRef: {video_ref}")
    return {"deleted": True}
