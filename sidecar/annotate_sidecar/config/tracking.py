from dataclasses import dataclass
from functools import lru_cache
import os


def _get_env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _get_env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _get_env_classes(name: str, default: tuple[int, ...]) -> tuple[int, ...]:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    values: list[int] = []
    for part in raw.split(","):
        piece = part.strip()
        if not piece:
            continue
        try:
            values.append(int(piece))
        except ValueError:
            return default
    return tuple(values) if values else default


@dataclass(frozen=True)
class TrackingDefaults:
    """
    App-owned tracking configuration for the trackers-backed OC-SORT path.
    """

    detector_model_name: str
    sample_fps: float
    classes: tuple[int, ...]
    conf_threshold: float
    iou_threshold: float
    track_buffer_frames: int
    minimum_consecutive_frames: int
    direction_consistency_weight: float
    high_conf_det_threshold: float
    delta_t: int

    def to_public_dict(self) -> dict:
        return {
            "backend": "ocsort",
            "detectorModelName": self.detector_model_name,
            "sampleFps": self.sample_fps,
            "classes": list(self.classes),
            "confThreshold": self.conf_threshold,
            "iouThreshold": self.iou_threshold,
            "trackBufferFrames": self.track_buffer_frames,
            "minimumConsecutiveFrames": self.minimum_consecutive_frames,
            "directionConsistencyWeight": self.direction_consistency_weight,
            "highConfDetThreshold": self.high_conf_det_threshold,
            "deltaT": self.delta_t,
        }


@lru_cache(maxsize=1)
def get_tracking_defaults() -> TrackingDefaults:
    return TrackingDefaults(
        detector_model_name=os.getenv("ANNOTATE_TRACKING_MODEL", "yolov8n.pt"),
        sample_fps=_get_env_float("ANNOTATE_TRACKING_SAMPLE_FPS", 30.0),
        classes=_get_env_classes("ANNOTATE_TRACKING_CLASSES", (0,)),
        conf_threshold=_get_env_float("ANNOTATE_TRACKING_CONF_THRESHOLD", 0.25),
        iou_threshold=_get_env_float("ANNOTATE_TRACKING_IOU_THRESHOLD", 0.3),
        track_buffer_frames=_get_env_int("ANNOTATE_TRACKING_TRACK_BUFFER", 30),
        minimum_consecutive_frames=_get_env_int(
            "ANNOTATE_TRACKING_MIN_CONSECUTIVE_FRAMES",
            1,
        ),
        direction_consistency_weight=_get_env_float(
            "ANNOTATE_TRACKING_DIRECTION_WEIGHT",
            0.2,
        ),
        high_conf_det_threshold=_get_env_float(
            "ANNOTATE_TRACKING_HIGH_CONF_THRESHOLD",
            0.25,
        ),
        delta_t=_get_env_int("ANNOTATE_TRACKING_DELTA_T", 3),
    )
