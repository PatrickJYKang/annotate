from __future__ import annotations

from dataclasses import asdict
from collections.abc import Callable
from threading import Lock

from .base import CalibrationProvider
from .providers import PnLCalibCalibrationProvider
from .types import CalibrationFrameRange, HomographyFrame


class CalibrationService:
    def __init__(
        self,
        providers: list[CalibrationProvider] | None = None,
    ):
        self._providers = providers or [PnLCalibCalibrationProvider()]
        self._lock = Lock()

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
        on_progress: Callable[[dict], None] | None = None,
        frame_range: CalibrationFrameRange | None = None,
    ) -> list[HomographyFrame]:
        provider = self.select_provider()
        if provider is None:
            raise RuntimeError("Homography estimation unavailable")
        # Models are reused, but a provider's runtime is not concurrently mutable.
        # Progress callbacks also provide a cancellation checkpoint while queued.
        while not self._lock.acquire(timeout=0.25):
            if on_progress:
                on_progress({"phase": "queued", "completed": 0, "total": 0})
        try:
            options = {"on_progress": on_progress} if on_progress else {}
            if frame_range is not None:
                options['frame_range'] = frame_range
            return provider.estimate_range(
                video_path=video_path, start_ms=start_ms, end_ms=end_ms,
                fps=fps, skip_interval=skip_interval, **options,
            )
        finally:
            self._lock.release()
