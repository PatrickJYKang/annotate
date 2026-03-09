"""
GET /health — reports sidecar status and model availability.
"""

import logging
import os
from pathlib import Path

# Ensure Keras 2 compatibility for segmentation_models
os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
os.environ.setdefault("SM_FRAMEWORK", "tf.keras")

from fastapi import APIRouter

router = APIRouter()
logger = logging.getLogger("annotate_sidecar.health")

# Models directory (relative to package root)
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def _check_model_importable(module_name: str) -> bool:
    """Try importing a module; return True if it succeeds."""
    try:
        __import__(module_name)
        return True
    except Exception:
        return False


def _check_capabilities() -> dict:
    """Check which models/libraries are available."""
    yolo = _check_model_importable("ultralytics")
    lap = _check_model_importable("lap") or _check_model_importable("lapx")
    mobilesam = _check_model_importable("mobile_sam") or _check_model_importable("segment_anything")
    # Narya is vendored; check its runtime dependencies instead
    narya_deps = all(
        _check_model_importable(m)
        for m in ("tensorflow", "torch", "kornia", "segmentation_models")
    )
    opencv = _check_model_importable("cv2")

    capabilities = []
    if yolo and lap and opencv:
        capabilities.append("tracking")
    if yolo and mobilesam and opencv:
        capabilities.append("segmentation")
    if opencv:
        capabilities.append("homography")
    if opencv:
        capabilities.append("frame_extraction")
        capabilities.append("export")

    return {
        "status": "ok",
        "capabilities": capabilities,
        "models": {
            "yolo": yolo,
            "lap": lap,
            "mobilesam": mobilesam,
            "narya": narya_deps,
            "opencv": opencv,
        },
    }


@router.get("/health")
async def health():
    """Return sidecar health and capability information."""
    return _check_capabilities()
