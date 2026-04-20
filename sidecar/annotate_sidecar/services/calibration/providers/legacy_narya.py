from __future__ import annotations

from collections.abc import Sequence

from ...homography_estimator import HomographyEstimator, HomographyFrame
from ..base import CalibrationProvider


class LegacyNaryaCalibrationProvider(CalibrationProvider):
    """
    Adapter around the existing color-first + vendored Narya estimator.

    This mirrors the provider-oriented shape we want from the `trackers`
    repo without forcing the app route layer to know about a concrete
    estimator implementation.
    """

    name = "legacy_narya"
    supports_manual_seed_tracking = True

    def __init__(self, estimator: HomographyEstimator | None = None):
        self._estimator = estimator or HomographyEstimator()

    @property
    def available(self) -> bool:
        return self._estimator.available

    def estimate_range(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        fps: float = 5.0,
        skip_interval: int = 0,
    ) -> list[HomographyFrame]:
        return self._estimator.estimate_range(
            video_path=video_path,
            start_ms=start_ms,
            end_ms=end_ms,
            fps=fps,
            skip_interval=skip_interval,
        )

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
        return self._estimator.estimate_range_from_seed_homography(
            video_path=video_path,
            start_ms=start_ms,
            end_ms=end_ms,
            seed_ms=seed_ms,
            seed_matrix=list(seed_matrix),
            fps=fps,
            skip_interval=skip_interval,
        )
