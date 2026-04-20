from fastapi import FastAPI
from fastapi.testclient import TestClient

from annotate_sidecar.config import TrackingDefaults
from annotate_sidecar.routes import track as track_route


class FakeRouteTracker:
    def __init__(self):
        self.calls: list[dict] = []

    def track_range(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "keyframes": [{"tMs": 1000.0, "x": 1, "y": 2, "w": 3, "h": 4, "visible": True}],
            "trackId": 7,
            "detectionCount": 1,
        }


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(track_route.router, prefix="/track")
    return TestClient(app)


def test_track_route_keeps_video_ref_resolution_in_annotate(monkeypatch, tmp_path):
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"demo")
    fake_tracker = FakeRouteTracker()
    defaults = TrackingDefaults(
        backend="bytetrack",
        detector_model_name="demo.pt",
        core_tracker_config="bytetrack.yaml",
        sample_fps=30.0,
        classes=(0,),
        conf_threshold=0.25,
        iou_threshold=0.3,
        track_buffer_frames=30,
    )

    monkeypatch.setattr(track_route, "_tracker", fake_tracker)
    monkeypatch.setattr(track_route, "resolve_video_ref", lambda video_ref: str(video_path) if video_ref == "ref-123" else None)
    monkeypatch.setattr(track_route, "get_tracking_defaults", lambda: defaults)

    response = make_client().post("/track", json={
        "videoRef": "ref-123",
        "startMs": 1000.0,
        "endMs": 1300.0,
        "seedBbox": {"x": 10, "y": 20, "w": 30, "h": 40},
        "seedFrameMs": 1100.0,
        "fps": 25.0,
        "confThreshold": 0.4,
        "iouThreshold": 0.5,
    })

    assert response.status_code == 200
    assert response.json() == {
        "keyframes": [{"tMs": 1000.0, "x": 1, "y": 2, "w": 3, "h": 4, "visible": True}],
        "trackId": 7,
        "detectionCount": 1,
    }
    assert fake_tracker.calls == [{
        "video_path": str(video_path),
        "start_ms": 1000.0,
        "end_ms": 1300.0,
        "seed_bbox": track_route.BBox(x=10, y=20, w=30, h=40),
        "seed_frame_ms": 1100.0,
        "fps": 25.0,
        "classes": [0],
        "conf_threshold": 0.4,
        "iou_threshold": 0.5,
        "track_buffer": 30,
    }]


def test_track_route_rejects_relative_video_path_before_tracker_call(monkeypatch):
    fake_tracker = FakeRouteTracker()
    monkeypatch.setattr(track_route, "_tracker", fake_tracker)
    monkeypatch.setattr(track_route, "resolve_video_ref", lambda video_ref: None)

    response = make_client().post("/track", json={
        "videoPath": "videos/demo.mp4",
        "startMs": 1000.0,
        "endMs": 1300.0,
        "seedBbox": {"x": 10, "y": 20, "w": 30, "h": 40},
        "seedFrameMs": 1100.0,
    })

    assert response.status_code == 400
    assert "Relative videoPath is unsupported" in response.json()["detail"]
    assert fake_tracker.calls == []


def test_track_route_uses_centralized_defaults_when_request_omits_optional_tuning(monkeypatch, tmp_path):
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"demo")
    fake_tracker = FakeRouteTracker()
    defaults = TrackingDefaults(
        backend="ocsort",
        detector_model_name="rfdetr-nano.pt",
        core_tracker_config="ocsort-demo",
        sample_fps=12.5,
        classes=(0, 32),
        conf_threshold=0.41,
        iou_threshold=0.66,
        track_buffer_frames=17,
    )

    monkeypatch.setattr(track_route, "_tracker", fake_tracker)
    monkeypatch.setattr(track_route, "resolve_video_ref", lambda video_ref: None)
    monkeypatch.setattr(track_route, "get_tracking_defaults", lambda: defaults)

    response = make_client().post("/track", json={
        "videoPath": str(video_path),
        "startMs": 1000.0,
        "endMs": 1300.0,
        "seedBbox": {"x": 10, "y": 20, "w": 30, "h": 40},
        "seedFrameMs": 1100.0,
    })

    assert response.status_code == 200
    assert fake_tracker.calls == [{
        "video_path": str(video_path),
        "start_ms": 1000.0,
        "end_ms": 1300.0,
        "seed_bbox": track_route.BBox(x=10, y=20, w=30, h=40),
        "seed_frame_ms": 1100.0,
        "fps": 12.5,
        "classes": [0, 32],
        "conf_threshold": 0.41,
        "iou_threshold": 0.66,
        "track_buffer": 17,
    }]
