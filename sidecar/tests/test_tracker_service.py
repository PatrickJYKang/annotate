from annotate_sidecar.config import TrackingDefaults
from annotate_sidecar.services.tracker import Tracker, BBox
from annotate_sidecar.vendor.trackers.core.types import FrameTrackResult


TEST_DEFAULTS = TrackingDefaults(
    detector_model_name="demo.pt",
    sample_fps=10.0,
    classes=(0,),
    conf_threshold=0.25,
    iou_threshold=0.15,
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
        FrameTrackResult(timestamp_ms=1000.0, detections=[]),
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
        assert "No detection sufficiently matches the seed bbox or foot anchor" in str(exc.args[0])
        assert exc.args[1] == []
    else:
        raise AssertionError("Expected track_range to raise ValueError on seed mismatch")


def test_track_range_falls_back_to_seed_coverage_when_iou_is_too_low():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=95, y=70, w=36, h=96, confidence=0.91, class_id=0, track_id=7),
            BBox(x=150, y=80, w=34, h=92, confidence=0.88, class_id=0, track_id=9),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[
            BBox(x=98, y=72, w=36, h=96, confidence=0.91, class_id=0, track_id=7),
        ]),
    ]
    tracker = Tracker(config=TEST_DEFAULTS, core=FakeTrackingCore(tracked_frames))

    result = tracker.track_range(
        video_path="/tmp/demo.mp4",
        start_ms=1000.0,
        end_ms=1100.0,
        seed_bbox=BBox(x=90, y=110, w=80, h=28),
        seed_frame_ms=1000.0,
        fps=10.0,
    )

    assert result["trackId"] == 7
    assert result["keyframes"] == [
        {"tMs": 1000.0, "x": 95, "y": 70, "w": 36, "h": 96, "visible": True},
        {"tMs": 1100.0, "x": 98, "y": 72, "w": 36, "h": 96, "visible": True},
    ]


def test_track_range_prefers_detection_containing_seed_foot_anchor():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=90, y=60, w=34, h=92, confidence=0.91, class_id=0, track_id=7),
            BBox(x=130, y=58, w=36, h=94, confidence=0.95, class_id=0, track_id=11),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[
            BBox(x=93, y=62, w=34, h=92, confidence=0.9, class_id=0, track_id=7),
        ]),
    ]
    tracker = Tracker(config=TEST_DEFAULTS, core=FakeTrackingCore(tracked_frames))

    result = tracker.track_range(
        video_path="/tmp/demo.mp4",
        start_ms=1000.0,
        end_ms=1100.0,
        seed_bbox=BBox(x=96, y=126, w=18, h=16),
        seed_frame_ms=1000.0,
        fps=10.0,
    )

    assert result["trackId"] == 7
    assert result["keyframes"] == [
        {"tMs": 1000.0, "x": 90, "y": 60, "w": 34, "h": 92, "visible": True},
        {"tMs": 1100.0, "x": 93, "y": 62, "w": 34, "h": 92, "visible": True},
    ]


def test_track_range_falls_back_to_nearest_detection_bottom_center():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=70, y=50, w=32, h=90, confidence=0.82, class_id=0, track_id=3),
            BBox(x=140, y=54, w=36, h=94, confidence=0.94, class_id=0, track_id=9),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[
            BBox(x=143, y=56, w=36, h=94, confidence=0.93, class_id=0, track_id=9),
        ]),
    ]
    tracker = Tracker(config=TEST_DEFAULTS, core=FakeTrackingCore(tracked_frames))

    result = tracker.track_range(
        video_path="/tmp/demo.mp4",
        start_ms=1000.0,
        end_ms=1100.0,
        seed_bbox=BBox(x=150, y=130, w=10, h=10),
        seed_frame_ms=1000.0,
        fps=10.0,
    )

    assert result["trackId"] == 9
    assert result["keyframes"] == [
        {"tMs": 1000.0, "x": 140, "y": 54, "w": 36, "h": 94, "visible": True},
        {"tMs": 1100.0, "x": 143, "y": 56, "w": 36, "h": 94, "visible": True},
    ]


def test_track_range_keeps_following_same_player_when_seed_frame_track_id_is_minus_one():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=100, y=70, w=34, h=92, confidence=0.93, class_id=0, track_id=-1),
            BBox(x=170, y=72, w=34, h=92, confidence=0.91, class_id=0, track_id=-1),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[
            BBox(x=104, y=72, w=34, h=92, confidence=0.9, class_id=0, track_id=9),
            BBox(x=174, y=74, w=34, h=92, confidence=0.89, class_id=0, track_id=3),
        ]),
        FrameTrackResult(timestamp_ms=1200.0, detections=[
            BBox(x=108, y=74, w=34, h=92, confidence=0.9, class_id=0, track_id=9),
            BBox(x=178, y=76, w=34, h=92, confidence=0.88, class_id=0, track_id=3),
        ]),
    ]
    tracker = Tracker(config=TEST_DEFAULTS, core=FakeTrackingCore(tracked_frames))

    result = tracker.track_range(
        video_path="/tmp/demo.mp4",
        start_ms=1000.0,
        end_ms=1200.0,
        seed_bbox=BBox(x=108, y=140, w=16, h=18),
        seed_frame_ms=1000.0,
        fps=10.0,
    )

    assert result["trackId"] == -1
    assert result["keyframes"] == [
        {"tMs": 1000.0, "x": 100, "y": 70, "w": 34, "h": 92, "visible": True},
        {"tMs": 1100.0, "x": 104, "y": 72, "w": 34, "h": 92, "visible": True},
        {"tMs": 1200.0, "x": 108, "y": 74, "w": 34, "h": 92, "visible": True},
    ]


def test_track_range_prefers_nearest_detection_when_old_track_id_jumps_unreasonably():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=100, y=70, w=34, h=92, confidence=0.94, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[
            BBox(x=108, y=73, w=34, h=92, confidence=0.91, class_id=0, track_id=11),
            BBox(x=280, y=100, w=36, h=92, confidence=0.92, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1200.0, detections=[
            BBox(x=114, y=76, w=34, h=92, confidence=0.9, class_id=0, track_id=11),
            BBox(x=286, y=104, w=36, h=92, confidence=0.91, class_id=0, track_id=7),
        ]),
    ]
    tracker = Tracker(config=TEST_DEFAULTS, core=FakeTrackingCore(tracked_frames))

    result = tracker.track_range(
        video_path="/tmp/demo.mp4",
        start_ms=1000.0,
        end_ms=1200.0,
        seed_bbox=BBox(x=108, y=140, w=16, h=18),
        seed_frame_ms=1000.0,
        fps=10.0,
    )

    assert result["trackId"] == 7
    assert result["keyframes"] == [
        {"tMs": 1000.0, "x": 100, "y": 70, "w": 34, "h": 92, "visible": True},
        {"tMs": 1100.0, "x": 108, "y": 73, "w": 34, "h": 92, "visible": True},
        {"tMs": 1200.0, "x": 114, "y": 76, "w": 34, "h": 92, "visible": True},
    ]
