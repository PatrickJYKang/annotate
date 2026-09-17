from fastapi import FastAPI
from fastapi.testclient import TestClient
import json
import pytest

from annotate_sidecar.services.calibration.types import HomographyFrame
from annotate_sidecar.services.calibration.types import CalibrationFrameRange
from annotate_sidecar.routes import homography as homography_route


class FakeCalibrationService:
    def __init__(self):
        self.available = True
        self.calls: list[dict] = []

    def estimate_range(self, **kwargs):
        progress = kwargs.pop('on_progress', None)
        if progress:
            progress({'phase': 'loading', 'completed': 0, 'total': 2})
            progress({'phase': 'computing', 'completed': 1, 'total': 2})
            progress({'phase': 'interpolating', 'completed': 2, 'total': 2})
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


def test_stream_reports_actual_counts_and_final_result(monkeypatch, tmp_path):
    source = tmp_path / 'video.mp4'
    source.write_bytes(b'video')
    monkeypatch.setattr(homography_route, '_service', FakeCalibrationService())
    response = make_client().post('/homography/stream', json={
        'videoPath': str(source), 'startMs': 1000, 'endMs': 1400,
    })
    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines() if line]
    assert [event.get('phase') for event in events[:-1]] == ['queued', 'loading', 'computing', 'interpolating']
    assert events[2]['completed'] == 1 and events[2]['total'] == 2
    assert events[-1]['type'] == 'result'
    assert len(events[-1]['result']['frames']) == 2


def test_stream_propagates_worker_errors(monkeypatch, tmp_path):
    source = tmp_path / 'video.mp4'
    source.write_bytes(b'video')
    service = FakeCalibrationService()
    def fail(**kwargs):
        raise RuntimeError('model failed')
    service.estimate_range = fail
    monkeypatch.setattr(homography_route, '_service', service)
    response = make_client().post('/homography/stream', json={'videoPath': str(source), 'startMs': 0, 'endMs': 200})
    assert json.loads(response.text.splitlines()[-1]) == {'type': 'error', 'message': 'model failed'}


@pytest.mark.parametrize('field,value', [('fps', 0), ('fps', -1), ('fps', 121), ('skipInterval', -1), ('startMs', -1), ('endMs', 0)])
def test_rejects_invalid_ranges_and_sample_rates(field, value):
    response = make_client().post('/homography/stream', json={
        'videoRef': 'ref', 'startMs': 0, 'endMs': 200, field: value,
    })
    assert response.status_code == 422


def test_stream_passes_source_frame_range_without_rounding(monkeypatch, tmp_path):
    source = tmp_path / 'video.mp4'
    source.write_bytes(b'video')
    service = FakeCalibrationService()
    monkeypatch.setattr(homography_route, '_service', service)
    fps = 30000 / 1001
    response = make_client().post('/homography/stream', json={
        'videoPath': str(source), 'startFrame': 7, 'endFrame': 608, 'sourceFps': fps, 'everyNFrames': 15,
    })
    assert response.status_code == 200
    assert service.calls[0]['frame_range'] == CalibrationFrameRange(7, 608, fps, 15)
    assert service.calls[0]['end_ms'] == pytest.approx(607 * 1000 / fps)


@pytest.mark.parametrize('field,value', [('startFrame', 1.5), ('endFrame', 0), ('sourceFps', 0), ('everyNFrames', 0)])
def test_stream_rejects_invalid_frame_contract(field, value):
    response = make_client().post('/homography/stream', json={
        'videoRef': 'ref', 'startFrame': 0, 'endFrame': 60, 'sourceFps': 30, 'everyNFrames': 15, field: value,
    })
    assert response.status_code == 422
