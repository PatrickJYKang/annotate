from dataclasses import dataclass
from typing import Optional


@dataclass
class BBox:
    """Bounding box in pixel coordinates (x, y, w, h)."""

    x: float
    y: float
    w: float
    h: float
    confidence: float = 0.0
    class_id: int = 0
    track_id: Optional[int] = None
    appearance: Optional[tuple[float, ...]] = None


@dataclass
class FrameTrackResult:
    """Tracked detections for one sampled frame."""

    timestamp_ms: float
    detections: list[BBox]
