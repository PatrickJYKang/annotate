from annotate_sidecar.config import TrackingDefaults
from annotate_sidecar.services.tracker import Tracker, BBox
from annotate_sidecar.vendor.trackers.core.types import FrameTrackResult


TEST_DEFAULTS = TrackingDefaults(
    detector_model_name="demo.pt",
    sample_fps=10.0,
    classes=(0,),
    conf_threshold=0.25,
    iou_threshold=0.3,
    track_buffer_frames=30,
    minimum_consecutive_frames=1,
    direction_consistency_weight=0.2,
    high_conf_det_threshold=0.25,
    delta_t=3,
)


class FakeTrackingCore:
    def __init__(self, tracked_frames: list[FrameTrackResult]):
        self.tracked_frames = tracked_frames
        self.calls: list[dict] = []

    def detect_frame(self, frame, classes=None, conf_threshold=0.25):
        return []

    def track_video_range(self, **kwargs):
        self.calls.append(kwargs)
        return self.tracked_frames


def test_track_range_keeps_response_shape_and_selects_seed_track():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=10, y=20, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
            BBox(x=80, y=90, w=20, h=20, confidence=0.7, class_id=0, track_id=11),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[
            BBox(x=14, y=24, w=30, h=40, confidence=0.91, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1200.0, detections=[
            BBox(x=18, y=28, w=30, h=40, confidence=0.92, class_id=0, track_id=7),
            BBox(x=70, y=80, w=10, h=12, confidence=0.6, class_id=0, track_id=4),
        ]),
    ]
    core = FakeTrackingCore(tracked_frames)
    tracker = Tracker(config=TEST_DEFAULTS, core=core)

    result = tracker.track_range(
        video_path="/tmp/demo.mp4",
        start_ms=1000.0,
        end_ms=1200.0,
        seed_bbox=BBox(x=11, y=21, w=30, h=40),
        seed_frame_ms=1000.0,
        fps=10.0,
    )

    assert core.calls == [{
        "video_path": "/tmp/demo.mp4",
        "start_ms": 1000.0,
        "end_ms": 1200.0,
        "fps": 10.0,
        "classes": [0],
        "conf_threshold": 0.25,
    }]
    assert result == {
        "keyframes": [
            {"tMs": 1000.0, "x": 10, "y": 20, "w": 30, "h": 40, "visible": True},
            {"tMs": 1100.0, "x": 14, "y": 24, "w": 30, "h": 40, "visible": True},
            {"tMs": 1200.0, "x": 18, "y": 28, "w": 30, "h": 40, "visible": True},
        ],
        "trackId": 7,
        "detectionCount": 5,
    }


def test_track_range_marks_invisible_after_track_buffer():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=10, y=20, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[]),
        FrameTrackResult(timestamp_ms=1200.0, detections=[]),
        FrameTrackResult(timestamp_ms=1300.0, detections=[
            BBox(x=20, y=30, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
    ]
    tracker = Tracker(config=TEST_DEFAULTS, core=FakeTrackingCore(tracked_frames))

    result = tracker.track_range(
        video_path="/tmp/demo.mp4",
        start_ms=1000.0,
        end_ms=1300.0,
        seed_bbox=BBox(x=10, y=20, w=30, h=40),
        seed_frame_ms=1000.0,
        fps=10.0,
        track_buffer=1,
    )

    assert result["keyframes"] == [
        {"tMs": 1000.0, "x": 10, "y": 20, "w": 30, "h": 40, "visible": True},
        {"tMs": 1200.0, "x": 0, "y": 0, "w": 0, "h": 0, "visible": False},
        {"tMs": 1300.0, "x": 20, "y": 30, "w": 30, "h": 40, "visible": True},
    ]


def test_track_range_surfaces_seed_detections_when_matching_fails():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=10, y=20, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
            BBox(x=50, y=60, w=10, h=15, confidence=0.8, class_id=0, track_id=8),
        ]),
    ]
    tracker = Tracker(config=TEST_DEFAULTS, core=FakeTrackingCore(tracked_frames))

    try:
        tracker.track_range(
            video_path="/tmp/demo.mp4",
            start_ms=1000.0,
            end_ms=1000.0,
            seed_bbox=BBox(x=200, y=200, w=20, h=20),
            seed_frame_ms=1000.0,
            fps=10.0,
        )
    except ValueError as exc:
        assert "No detection matches seed bbox" in str(exc.args[0])
        assert exc.args[1] == [
            {"x": 10, "y": 20, "w": 30, "h": 40, "confidence": 0.9},
            {"x": 50, "y": 60, "w": 10, "h": 15, "confidence": 0.8},
        ]
    else:
        raise AssertionError("Expected track_range to raise ValueError on seed mismatch")
