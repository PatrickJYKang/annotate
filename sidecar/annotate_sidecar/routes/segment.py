"""
POST /segment — person segmentation (YOLO + MobileSAM).

Extracts a frame at the requested timestamp, runs YOLO person detection
+ MobileSAM box-prompted segmentation, returns a base64-encoded alpha
mask PNG.
"""

import base64
import logging
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from ..services.segmenter import Segmenter
from ..services.frame_extractor import extract_frame
from ..project_root import resolve_video_path

router = APIRouter()
logger = logging.getLogger("annotate_sidecar.routes.segment")

_segmenter = Segmenter()


class SegmentRequest(BaseModel):
    videoPath: str
    frameMs: float
    confThreshold: float = 0.3

    @field_validator("frameMs")
    @classmethod
    def frame_ms_non_negative(cls, v: float) -> float:
        if v < 0:
            raise ValueError("frameMs must be >= 0")
        return v


@router.post("")
async def segment(req: SegmentRequest):
    """Segment people in a video frame.

    Returns:
        { mask: "data:image/png;base64,...", width, height, personCount }
    """
    if not _segmenter.sam_available:
        raise HTTPException(
            status_code=501,
            detail="MobileSAM not installed. Install with: "
                   "pip install git+https://github.com/ChaoningZhang/MobileSAM.git",
        )

    video_path = resolve_video_path(req.videoPath)
    if not Path(video_path).exists():
        raise HTTPException(status_code=404, detail=f"Video not found: {video_path}")

    try:
        frame = extract_frame(video_path, req.frameMs)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    h, w = frame.shape[:2]

    try:
        alpha_mask = _segmenter.segment_frame(frame, conf_threshold=req.confThreshold)
    except Exception as e:
        logger.error("Segmentation failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {e}")

    # Count people detected (number of connected components minus background)
    person_count = 0
    if np.any(alpha_mask > 0):
        # Rough count from YOLO (re-detect is wasteful, but segment_frame
        # doesn't expose bbox count; use connected components as proxy)
        num_labels, _ = cv2.connectedComponents(alpha_mask)
        person_count = max(0, num_labels - 1)  # subtract background label

    # Encode alpha mask as single-channel PNG
    success, png_buf = cv2.imencode(".png", alpha_mask)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to encode mask as PNG")

    b64 = base64.b64encode(png_buf.tobytes()).decode("ascii")
    data_uri = f"data:image/png;base64,{b64}"

    return {
        "mask": data_uri,
        "width": w,
        "height": h,
        "personCount": person_count,
    }
