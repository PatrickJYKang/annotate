"""
Export routes — frame collection and ffmpeg encoding.

Frontend-driven pipeline:
  1. POST /export/start   — create temp dir, return sessionId
  2. POST /export/frame   — receive base64 JPEG, write numbered frame
  3. POST /export/encode  — run ffmpeg on collected frames → MP4
  4. DELETE /export/{id}  — clean up temp dir
"""

import base64
import logging
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..services.encoder import check_ffmpeg, encode_frames

router = APIRouter()
logger = logging.getLogger("annotate_sidecar.routes.export")

# Active export sessions: sessionId → temp directory path
_sessions: dict[str, str] = {}
_outputs: dict[str, str] = {}


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class ExportStartRequest(BaseModel):
    clipId: str
    fps: float = 30.0
    width: int = 1920
    height: int = 1080


class ExportFrameRequest(BaseModel):
    sessionId: str
    frameIndex: int
    image: str  # base64-encoded JPEG (no data URI prefix) or data URI


class ExportEncodeRequest(BaseModel):
    sessionId: str
    outputPath: Optional[str] = None
    fps: float = 30.0


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/start")
async def export_start(req: ExportStartRequest):
    """Create a temporary directory for frame collection.

    Returns:
        { sessionId, framesDir }
    """
    if not check_ffmpeg():
        raise HTTPException(
            status_code=501,
            detail="ffmpeg not found on PATH. Install ffmpeg to enable export.",
        )

    session_id = uuid.uuid4().hex[:12]
    tmp_dir = tempfile.mkdtemp(prefix=f"annotate_export_{session_id}_")
    _sessions[session_id] = tmp_dir

    logger.info(
        "Export session %s started for clip %s (%dx%d @ %.1f fps) → %s",
        session_id, req.clipId, req.width, req.height, req.fps, tmp_dir,
    )

    return {"sessionId": session_id, "framesDir": tmp_dir}


@router.post("/frame")
async def export_frame(req: ExportFrameRequest):
    """Receive a rendered frame and write it to disk.

    The `image` field should be a base64-encoded JPEG. It may optionally
    include a `data:image/jpeg;base64,` prefix which will be stripped.

    Returns:
        { frameIndex, path }
    """
    tmp_dir = _sessions.get(req.sessionId)
    if not tmp_dir:
        raise HTTPException(status_code=404, detail=f"Unknown session: {req.sessionId}")

    # Strip data URI prefix if present
    image_data = req.image
    if image_data.startswith("data:"):
        # e.g. data:image/jpeg;base64,/9j/4AAQ...
        _, image_data = image_data.split(",", 1)

    try:
        raw = base64.b64decode(image_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image: {e}")

    frame_path = Path(tmp_dir) / f"frame_{req.frameIndex:06d}.jpg"
    frame_path.write_bytes(raw)

    return {"frameIndex": req.frameIndex, "path": str(frame_path)}


@router.post("/encode")
async def export_encode(req: ExportEncodeRequest):
    """Encode collected frames into an MP4 video.

    If `outputPath` is not specified, the MP4 is written next to the
    frames directory.

    Returns:
        { outputPath }
    """
    tmp_dir = _sessions.get(req.sessionId)
    if not tmp_dir:
        raise HTTPException(status_code=404, detail=f"Unknown session: {req.sessionId}")

    # Default output path: next to temp dir
    output_path = req.outputPath
    if not output_path:
        output_path = str(Path(tmp_dir).parent / f"export_{req.sessionId}.mp4")

    try:
        result_path = encode_frames(
            frames_dir=tmp_dir,
            output_path=output_path,
            fps=req.fps,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    _outputs[req.sessionId] = result_path
    logger.info("Export session %s encoded → %s", req.sessionId, result_path)
    return {"outputPath": result_path}


@router.get("/{session_id}/file")
async def export_file(session_id: str):
    """Return the encoded MP4 for a completed export session."""
    output_path = _outputs.get(session_id)
    if not output_path:
        raise HTTPException(status_code=404, detail=f"No encoded export for session: {session_id}")

    artifact = Path(output_path)
    if not artifact.exists():
        raise HTTPException(status_code=404, detail=f"Export file missing for session: {session_id}")

    return FileResponse(str(artifact), media_type="video/mp4", filename=artifact.name)


@router.delete("/{session_id}")
async def export_cleanup(session_id: str):
    """Clean up an export session's temporary directory.

    Returns:
        { deleted: true }
    """
    tmp_dir = _sessions.pop(session_id, None)
    if not tmp_dir:
        raise HTTPException(status_code=404, detail=f"Unknown session: {session_id}")
    _outputs.pop(session_id, None)

    try:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        logger.info("Export session %s cleaned up: %s", session_id, tmp_dir)
    except Exception as e:
        logger.warning("Failed to clean up %s: %s", tmp_dir, e)

    return {"deleted": True}
