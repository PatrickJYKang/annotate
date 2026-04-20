from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Sequence

from ..homography_estimator import HomographyFrame


@dataclass(frozen=True)
class CalibrationProviderSummary:
    name: str
    supports_manual_seed_tracking: bool
    available: bool


class CalibrationProvider(ABC):
    name: str = "unknown"
    supports_manual_seed_tracking: bool = False

    @property
    @abstractmethod
    def available(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def estimate_range(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        fps: float = 5.0,
        skip_interval: int = 0,
    ) -> list[HomographyFrame]:
        raise NotImplementedError

    def estimate_range_from_seed_homography(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        seed_ms: float,
        seed_matrix: Sequence[float],
        fps: float = 5.0,
        skip_interval: int = 0,
    ) -> list[HomographyFrame]:
        raise NotImplementedError(f"{self.name} does not support manual seed homography tracking")

    def to_summary(self) -> CalibrationProviderSummary:
        return CalibrationProviderSummary(
            name=self.name,
            supports_manual_seed_tracking=self.supports_manual_seed_tracking,
            available=self.available,
        )
