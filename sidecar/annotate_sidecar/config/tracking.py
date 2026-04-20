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
    App-owned tracking configuration.

    The sidecar owns the practical defaults annotate wants to use. The vendored
    tracker core can still own lower-level implementation details.
    """

    backend: str
    detector_model_name: str
    core_tracker_config: str
    sample_fps: float
    classes: tuple[int, ...]
    conf_threshold: float
    iou_threshold: float
    track_buffer_frames: int

    def to_public_dict(self) -> dict:
        return {
            "backend": self.backend,
            "detectorModelName": self.detector_model_name,
            "coreTrackerConfig": self.core_tracker_config,
            "sampleFps": self.sample_fps,
            "classes": list(self.classes),
            "confThreshold": self.conf_threshold,
            "iouThreshold": self.iou_threshold,
            "trackBufferFrames": self.track_buffer_frames,
        }


@lru_cache(maxsize=1)
def get_tracking_defaults() -> TrackingDefaults:
    return TrackingDefaults(
        backend=os.getenv("ANNOTATE_TRACKING_BACKEND", "bytetrack"),
        detector_model_name=os.getenv("ANNOTATE_TRACKING_MODEL", "yolov8n.pt"),
        core_tracker_config=os.getenv("ANNOTATE_TRACKING_CORE_CONFIG", "bytetrack.yaml"),
        sample_fps=_get_env_float("ANNOTATE_TRACKING_SAMPLE_FPS", 30.0),
        classes=_get_env_classes("ANNOTATE_TRACKING_CLASSES", (0,)),
        conf_threshold=_get_env_float("ANNOTATE_TRACKING_CONF_THRESHOLD", 0.25),
        iou_threshold=_get_env_float("ANNOTATE_TRACKING_IOU_THRESHOLD", 0.3),
        track_buffer_frames=_get_env_int("ANNOTATE_TRACKING_TRACK_BUFFER", 30),
    )
