from __future__ import annotations

from dataclasses import asdict

from .base import CalibrationProvider
from .providers import PnLCalibCalibrationProvider
from .types import HomographyFrame


class CalibrationService:
    def __init__(
        self,
        providers: list[CalibrationProvider] | None = None,
    ):
        self._providers = providers or [PnLCalibCalibrationProvider()]

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
        return provider.estimate_range(
            video_path=video_path,
            start_ms=start_ms,
            end_ms=end_ms,
            fps=fps,
            skip_interval=skip_interval,
        )
