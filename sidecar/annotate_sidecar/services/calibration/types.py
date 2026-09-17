from __future__ import annotations

from dataclasses import dataclass
import math


@dataclass(frozen=True, slots=True)
class CalibrationFrameRange:
    start_frame: int
    end_frame: int  # Exclusive source-frame boundary.
    source_fps: float
    every_n_frames: int

    def __post_init__(self):
        if any(type(value) is not int for value in (self.start_frame, self.end_frame, self.every_n_frames)):
            raise ValueError('Calibration frame indices and intervals must be integers')
        if self.start_frame < 0 or self.end_frame <= self.start_frame or self.every_n_frames < 1:
            raise ValueError('Invalid calibration frame range')
        if not math.isfinite(self.source_fps) or self.source_fps <= 0:
            raise ValueError('Invalid source FPS')

    @property
    def sample_step(self) -> int:
        # Retain intermediate samples for the existing preprocessing/smoother,
        # but place every inference on an exact source-frame index.
        return self.every_n_frames // math.gcd(self.every_n_frames, 5)


@dataclass(slots=True)
class HomographyFrame:
    """Public homography frame returned to the annotate app."""

    tMs: float
    matrix: list[float]
    method: str
