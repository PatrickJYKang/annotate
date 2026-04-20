from fastapi import FastAPI
from fastapi.testclient import TestClient

from annotate_sidecar.services.homography_estimator import HomographyFrame
from annotate_sidecar.routes import homography as homography_route


class FakeCalibrationService:
    def __init__(self):
        self.available = True
        self.calls: list[dict] = []

    def estimate_range(self, **kwargs):
        self.calls.append({"mode": "range", **kwargs})
        return [
            HomographyFrame(
                tMs=1000.0,
                matrix=[1.0, 0.0, 12.0, 0.0, 1.0, 8.0, 0.0, 0.0, 1.0],
                method="color",
            ),
            HomographyFrame(
                tMs=1200.0,
                matrix=[1.0, 0.0, 14.0, 0.0, 1.0, 9.0, 0.0, 0.0, 1.0],
                method="held_short_gap",
            ),
        ]

    def estimate_range_from_seed_homography(self, **kwargs):
        self.calls.append({"mode": "manual_track", **kwargs})
        return [
            HomographyFrame(
                tMs=1100.0,
                matrix=[1.0, 0.0, 10.0, 0.0, 1.0, 6.0, 0.0, 0.0, 1.0],
                method="manual_keypoints",
            ),
            HomographyFrame(
                tMs=1300.0,
                matrix=[1.0, 0.0, 16.0, 0.0, 1.0, 11.0, 0.0, 0.0, 1.0],
                method="cv",
            ),
        ]


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(homography_route.router, prefix="/homography")
    return TestClient(app)


def test_homography_route_keeps_response_shape_stable(monkeypatch, tmp_path):
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"demo")
    fake_service = FakeCalibrationService()

    monkeypatch.setattr(homography_route, "_service", fake_service)
    monkeypatch.setattr(
        homography_route,
        "resolve_video_ref",
        lambda video_ref: str(video_path) if video_ref == "ref-123" else None,
    )

    response = make_client().post("/homography", json={
        "videoRef": "ref-123",
        "startMs": 1000.0,
        "endMs": 1400.0,
        "fps": 4.0,
        "skipInterval": 1,
    })

    assert response.status_code == 200
    assert response.json() == {
        "frames": [
            {
                "tMs": 1000.0,
                "matrix": [1.0, 0.0, 12.0, 0.0, 1.0, 8.0, 0.0, 0.0, 1.0],
                "method": "color",
            },
            {
                "tMs": 1200.0,
                "matrix": [1.0, 0.0, 14.0, 0.0, 1.0, 9.0, 0.0, 0.0, 1.0],
                "method": "held_short_gap",
            },
        ],
    }
    assert fake_service.calls == [{
        "mode": "range",
        "video_path": str(video_path),
        "start_ms": 1000.0,
        "end_ms": 1400.0,
        "fps": 4.0,
        "skip_interval": 1,
    }]


def test_manual_track_homography_route_keeps_response_shape_stable(monkeypatch, tmp_path):
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"demo")
    fake_service = FakeCalibrationService()

    monkeypatch.setattr(homography_route, "_service", fake_service)
    monkeypatch.setattr(homography_route, "resolve_video_ref", lambda video_ref: None)

    response = make_client().post("/homography/manual-track", json={
        "videoPath": str(video_path),
        "startMs": 1000.0,
        "endMs": 1400.0,
        "seedMs": 1100.0,
        "seedMatrix": [1, 0, 10, 0, 1, 20, 0, 0, 1],
        "fps": 6.0,
        "skipInterval": 2,
    })

    assert response.status_code == 200
    assert response.json() == {
        "frames": [
            {
                "tMs": 1100.0,
                "matrix": [1.0, 0.0, 10.0, 0.0, 1.0, 6.0, 0.0, 0.0, 1.0],
                "method": "manual_keypoints",
            },
            {
                "tMs": 1300.0,
                "matrix": [1.0, 0.0, 16.0, 0.0, 1.0, 11.0, 0.0, 0.0, 1.0],
                "method": "cv",
            },
        ],
    }
    assert fake_service.calls == [{
        "mode": "manual_track",
        "video_path": str(video_path),
        "start_ms": 1000.0,
        "end_ms": 1400.0,
        "seed_ms": 1100.0,
        "seed_matrix": [1.0, 0.0, 10.0, 0.0, 1.0, 20.0, 0.0, 0.0, 1.0],
        "fps": 6.0,
        "skip_interval": 2,
    }]
