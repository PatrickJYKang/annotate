from annotate_sidecar.services.calibration.base import CalibrationProvider
from annotate_sidecar.services.calibration.service import CalibrationService
from annotate_sidecar.services.homography_estimator import HomographyFrame


class FakeCalibrationProvider(CalibrationProvider):
    name = "fake"
    supports_manual_seed_tracking = True

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
        self.calls.append({
            "mode": "manual_track",
            "video_path": video_path,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "seed_ms": seed_ms,
            "seed_matrix": list(seed_matrix),
            "fps": fps,
            "skip_interval": skip_interval,
        })
        return list(self._frames)


def test_calibration_service_fills_only_short_failed_gaps():
    frames = [
        HomographyFrame(tMs=1000.0, matrix=[1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], method="color"),
        HomographyFrame(tMs=1200.0, matrix=[1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], method="failed"),
        HomographyFrame(tMs=1400.0, matrix=[2.0, 0.0, 5.0, 0.0, 2.0, 6.0, 0.0, 0.0, 1.0], method="cv"),
        HomographyFrame(tMs=1600.0, matrix=[2.0, 0.0, 5.0, 0.0, 2.0, 6.0, 0.0, 0.0, 1.0], method="failed"),
        HomographyFrame(tMs=1800.0, matrix=[2.0, 0.0, 5.0, 0.0, 2.0, 6.0, 0.0, 0.0, 1.0], method="failed"),
        HomographyFrame(tMs=2000.0, matrix=[3.0, 0.0, 7.0, 0.0, 3.0, 9.0, 0.0, 0.0, 1.0], method="torch"),
    ]
    provider = FakeCalibrationProvider(frames)
    service = CalibrationService(providers=[provider], short_failed_gap_frames=1)

    smoothed = service.estimate_range("/tmp/demo.mp4", 1000.0, 2000.0, fps=5.0)

    assert [frame.method for frame in smoothed] == [
        "color",
        "held_short_gap",
        "cv",
        "failed",
        "failed",
        "torch",
    ]
    assert smoothed[1].matrix == frames[0].matrix
    assert smoothed[3].matrix == frames[3].matrix
    assert provider.calls == [{
        "mode": "range",
        "video_path": "/tmp/demo.mp4",
        "start_ms": 1000.0,
        "end_ms": 2000.0,
        "fps": 5.0,
        "skip_interval": 0,
    }]


def test_calibration_service_reports_provider_metadata():
    available = FakeCalibrationProvider([], available=True)
    unavailable = FakeCalibrationProvider([], available=False)
    unavailable.name = "unavailable"
    service = CalibrationService(providers=[unavailable, available], short_failed_gap_frames=3)

    public = service.describe_public()

    assert public == {
        "providerName": "fake",
        "shortFailedGapFrames": 3,
        "providers": [
            {
                "name": "unavailable",
                "supports_manual_seed_tracking": True,
                "available": False,
            },
            {
                "name": "fake",
                "supports_manual_seed_tracking": True,
                "available": True,
            },
        ],
    }
