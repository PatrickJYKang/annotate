import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from annotate_sidecar.config import TrackingDefaults
from annotate_sidecar.routes import track as track_route


class FakeRouteTracker:
    def __init__(self):
        self.calls: list[dict] = []
        self.detect_calls: list[dict] = []

    def track_range(self, **kwargs):
        self.calls.append(kwargs)
        keyframe = {"tMs": 1000.0, "x": 1, "y": 2, "w": 3, "h": 4, "visible": True}
        progress_callback = kwargs.get("progress_callback")
        if progress_callback is not None:
            progress_callback(keyframe)
        return {
            "keyframes": [keyframe],
            "trackId": 7,
            "detectionCount": 1,
            "debugVideoPath": "/tmp/tracking_debug_demo.mp4",
        }

    def detect_frame(self, frame, **kwargs):
        self.detect_calls.append({"frame": frame, **kwargs})
        return [track_route.BBox(x=10, y=20, w=30, h=40, confidence=0.9)]


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(track_route.router, prefix="/track")
    return TestClient(app)


def test_track_route_keeps_video_ref_resolution_in_annotate(monkeypatch, tmp_path):
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"demo")
    fake_tracker = FakeRouteTracker()
    defaults = TrackingDefaults(
        detector_model_name="demo.pt",
        sample_fps=30.0,
        classes=(0,),
        conf_threshold=0.25,
        iou_threshold=0.3,
        track_buffer_frames=30,
        minimum_consecutive_frames=1,
        direction_consistency_weight=0.2,
        high_conf_det_threshold=0.25,
        delta_t=3,
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
        "debugVideoPath": "/tmp/tracking_debug_demo.mp4",
        "debugVideoUrl": "/track/debug/tracking_debug_demo.mp4",
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
        "debug_video": False,
        "stop_on_loss": False,
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
        detector_model_name="rfdetr-nano.pt",
        sample_fps=12.5,
        classes=(0, 32),
        conf_threshold=0.41,
        iou_threshold=0.66,
        track_buffer_frames=17,
        minimum_consecutive_frames=1,
        direction_consistency_weight=0.4,
        high_conf_det_threshold=0.5,
        delta_t=5,
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
        "debug_video": False,
        "stop_on_loss": False,
    }]


def test_detect_players_returns_every_detection_at_requested_frame(monkeypatch, tmp_path):
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"demo")
    fake_tracker = FakeRouteTracker()
    frame = object()

    monkeypatch.setattr(track_route, "_tracker", fake_tracker)
    monkeypatch.setattr(track_route, "resolve_video_ref", lambda video_ref: str(video_path))
    monkeypatch.setattr(track_route, "extract_frame", lambda path, frame_ms: frame)

    response = make_client().post("/track/detect", json={
        "videoRef": "ref-123",
        "frameMs": 1250.0,
        "confThreshold": 0.4,
    })

    assert response.status_code == 200
    assert response.json() == {
        "frameMs": 1250.0,
        "detections": [{"x": 10.0, "y": 20.0, "w": 30.0, "h": 40.0, "confidence": 0.9}],
    }
    assert fake_tracker.detect_calls == [{
        "frame": frame,
        "classes": [0],
        "conf_threshold": 0.4,
    }]


def test_track_route_forwards_stop_on_loss(monkeypatch, tmp_path):
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"demo")
    fake_tracker = FakeRouteTracker()
    monkeypatch.setattr(track_route, "_tracker", fake_tracker)
    monkeypatch.setattr(track_route, "resolve_video_ref", lambda video_ref: str(video_path))

    response = make_client().post("/track", json={
        "videoRef": "ref-123",
        "startMs": 1000.0,
        "endMs": 1300.0,
        "seedBbox": {"x": 10, "y": 20, "w": 30, "h": 40},
        "seedFrameMs": 1000.0,
        "stopOnLoss": True,
    })

    assert response.status_code == 200
    assert fake_tracker.calls[0]["stop_on_loss"] is True


def test_track_stream_emits_keyframes_before_the_final_result(monkeypatch, tmp_path):
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"demo")
    fake_tracker = FakeRouteTracker()
    monkeypatch.setattr(track_route, "_tracker", fake_tracker)
    monkeypatch.setattr(track_route, "resolve_video_ref", lambda video_ref: str(video_path))

    response = make_client().post("/track/stream", json={
        "videoRef": "ref-123",
        "startMs": 1000.0,
        "endMs": 1300.0,
        "seedBbox": {"x": 10, "y": 20, "w": 30, "h": 40},
        "seedFrameMs": 1000.0,
        "stopOnLoss": True,
    })

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0] == {
        "type": "keyframe",
        "keyframe": {"tMs": 1000.0, "x": 1, "y": 2, "w": 3, "h": 4, "visible": True},
    }
    assert events[1]["type"] == "result"
    assert events[1]["result"]["keyframes"] == [events[0]["keyframe"]]
    assert callable(fake_tracker.calls[0]["progress_callback"])


def test_track_debug_route_serves_saved_artifact(monkeypatch, tmp_path):
    artifact = tmp_path / "tracking_debug_test.mp4"
    artifact.write_bytes(b"debug-video")
    monkeypatch.setattr(track_route, "resolve_tracking_debug_artifact", lambda name: artifact if name == artifact.name else None)

    response = make_client().get(f"/track/debug/{artifact.name}")

    assert response.status_code == 200
    assert response.content == b"debug-video"
    assert response.headers["content-type"] == "video/mp4"
