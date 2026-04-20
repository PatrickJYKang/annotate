from __future__ import annotations

from dataclasses import asdict

from ..homography_estimator import HomographyFrame
from .base import CalibrationProvider
from .providers import LegacyNaryaCalibrationProvider
from .smoothing import SHORT_FAILED_GAP_MAX_FRAMES, fill_short_failed_gaps


class CalibrationService:
    def __init__(
        self,
        providers: list[CalibrationProvider] | None = None,
        short_failed_gap_frames: int = SHORT_FAILED_GAP_MAX_FRAMES,
    ):
        self._providers = providers or [LegacyNaryaCalibrationProvider()]
        self._short_failed_gap_frames = short_failed_gap_frames

    @property
    def available(self) -> bool:
        return any(provider.available for provider in self._providers)

    def select_provider(self) -> CalibrationProvider | None:
        for provider in self._providers:
            if provider.available:
                return provider
        return None

    def describe_public(self) -> dict:
        provider = self.select_provider()
        return {
            "providerName": provider.name if provider else None,
            "shortFailedGapFrames": self._short_failed_gap_frames,
            "providers": [asdict(summary) for summary in (p.to_summary() for p in self._providers)],
        }

    def estimate_range(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        fps: float = 5.0,
        skip_interval: int = 0,
    ) -> list[HomographyFrame]:
        provider = self.select_provider()
        if provider is None:
            raise RuntimeError("Homography estimation unavailable")
        frames = provider.estimate_range(
            video_path=video_path,
            start_ms=start_ms,
            end_ms=end_ms,
            fps=fps,
            skip_interval=skip_interval,
        )
        return fill_short_failed_gaps(frames, max_failed_gap_frames=self._short_failed_gap_frames)

    def estimate_range_from_seed_homography(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        seed_ms: float,
        seed_matrix: list[float],
        fps: float = 5.0,
        skip_interval: int = 0,
    ) -> list[HomographyFrame]:
        provider = self.select_provider()
        if provider is None:
            raise RuntimeError("Homography estimation unavailable")
        if not provider.supports_manual_seed_tracking:
            raise RuntimeError(f"{provider.name} does not support manual seed homography tracking")
        frames = provider.estimate_range_from_seed_homography(
            video_path=video_path,
            start_ms=start_ms,
            end_ms=end_ms,
            seed_ms=seed_ms,
            seed_matrix=seed_matrix,
            fps=fps,
            skip_interval=skip_interval,
        )
        return fill_short_failed_gaps(frames, max_failed_gap_frames=self._short_failed_gap_frames)
