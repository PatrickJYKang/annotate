from annotate_sidecar.services.calibration.base import CalibrationProvider
from annotate_sidecar.services.calibration.service import CalibrationService
from annotate_sidecar.services.calibration.types import HomographyFrame


class FakeCalibrationProvider(CalibrationProvider):
    name = "fake"

    def __init__(self, frames: list[HomographyFrame], available: bool = True):
        self._frames = frames
        self._available = available
        self.calls: list[dict] = []

    @property
    def available(self) -> bool:
        return self._available

    def estimate_range(
        self,
        video_path: str,
        start_ms: float,
        end_ms: float,
        fps: float = 5.0,
        skip_interval: int = 0,
    ) -> list[HomographyFrame]:
        self.calls.append({
            "mode": "range",
            "video_path": video_path,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "fps": fps,
            "skip_interval": skip_interval,
        })
        return list(self._frames)

def test_calibration_service_returns_provider_frames():
    frames = [
        HomographyFrame(tMs=1000.0, matrix=[1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], method="pnlcalib"),
        HomographyFrame(tMs=1200.0, matrix=[1.0, 0.0, 4.0, 0.0, 1.0, 3.0, 0.0, 0.0, 1.0], method="held_short_gap"),
    ]
    provider = FakeCalibrationProvider(frames)
    service = CalibrationService(providers=[provider])

    result = service.estimate_range("/tmp/demo.mp4", 1000.0, 1200.0, fps=5.0)

    assert result == frames
    assert provider.calls == [{
        "mode": "range",
        "video_path": "/tmp/demo.mp4",
        "start_ms": 1000.0,
        "end_ms": 1200.0,
        "fps": 5.0,
        "skip_interval": 0,
    }]


def test_calibration_service_reports_provider_metadata():
    available = FakeCalibrationProvider([], available=True)
    unavailable = FakeCalibrationProvider([], available=False)
    unavailable.name = "unavailable"
    service = CalibrationService(providers=[unavailable, available])

    public = service.describe_public()

    assert public == {
        "providerName": "fake",
        "providers": [
            {
                "name": "unavailable",
                "supports_manual_seed_tracking": False,
                "available": False,
            },
            {
                "name": "fake",
                "supports_manual_seed_tracking": False,
                "available": True,
            },
        ],
    }
