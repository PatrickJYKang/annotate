"""
GET /health — reports sidecar status and model availability.
"""

import logging
import os

# Ensure Keras 2 compatibility for segmentation_models
os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
os.environ.setdefault("SM_FRAMEWORK", "tf.keras")

from fastapi import APIRouter

from ..config import get_tracking_defaults
from ..services.calibration.service import CalibrationService

router = APIRouter()
logger = logging.getLogger("annotate_sidecar.health")
_calibration_service = CalibrationService()


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
    supervision = _check_model_importable("supervision")
    mobilesam = _check_model_importable("mobile_sam") or _check_model_importable("segment_anything")
    ellipse = _check_model_importable("ellipse")
    opencv = _check_model_importable("cv2")
    pnlcalib = _calibration_service.available

    capabilities = []
    if yolo and supervision and opencv:
        capabilities.append("tracking")
    if yolo and mobilesam and opencv:
        capabilities.append("segmentation")
    if pnlcalib:
        capabilities.append("homography")
    if opencv:
        capabilities.append("frame_extraction")
        capabilities.append("export")

    return {
        "status": "ok",
        "capabilities": capabilities,
        "models": {
            "yolo": yolo,
            "supervision": supervision,
            "mobilesam": mobilesam,
            "ellipse": ellipse,
            "pnlcalib": pnlcalib,
            "opencv": opencv,
        },
        "tracking": get_tracking_defaults().to_public_dict(),
        "homography": _calibration_service.describe_public(),
    }


@router.get("/health")
async def health():
    """Return sidecar health and capability information."""
    return _check_capabilities()
