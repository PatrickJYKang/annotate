import pytest

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


class IncrementalFakeTrackingCore(FakeTrackingCore):
    supports_incremental_stop = True

    def __init__(self, tracked_frames: list[FrameTrackResult]):
        super().__init__(tracked_frames)
        self.processed_frames = 0

    def track_video_range(self, stop_callback=None, **kwargs):
        self.calls.append(kwargs)
        output = []
        for frame in self.tracked_frames:
            self.processed_frames += 1
            output.append(frame)
            if stop_callback and stop_callback(frame):
                break
        return output


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


def test_clip_pass_reuses_every_player_even_after_loss(tmp_path):
    path = tmp_path / "match.mp4"
    path.touch()
    a, b = BBox(10, 10, 8, 20, track_id=1), BBox(80, 10, 8, 20, track_id=2)
    core = IncrementalFakeTrackingCore([FrameTrackResult(i * 100, [a, b] if i == 5 else [b]) for i in range(5, 12)])
    tracker = Tracker(config=TEST_DEFAULTS, core=core)
    def run(seed, frame, events):
        return tracker.track_clip_player(str(path), (5,12), 10, [0], .25, frame, seed, False, .3, events.append)
    assert run(a, 5, [])["stoppedAtMs"] == 600
    events = []
    assert run(b, 6, events)["completed"]
    assert [e["tMs"] for e in events] == list(range(600,1200,100))
    assert events[0]["cached"]
    assert all(e["x"] == b.x for e in events)
    assert core.processed_frames == 7 and len(core.calls) == 1
    assert tracker.cached_frame(str(path), (5,12), 10, [0], .25, 10).detections == [b]
    assert tracker.cached_frame(str(path), (5,11), 10, [0], .25, 10) is None


@pytest.mark.parametrize("nearby,expected", [([], 100), ([BBox(7,10,8,20),BBox(13,10,8,20)], 100), ([BBox(11,10,8,20,track_id=7)], None)])
def test_manual_tracking_point_is_authoritative_and_not_shared(tmp_path, nearby, expected):
    path = tmp_path / "match.mp4"
    path.touch()
    seed = BBox(10,10,8,20)
    other = BBox(100,10,8,20,track_id=9)
    core = IncrementalFakeTrackingCore([FrameTrackResult(0,[other]),FrameTrackResult(100,nearby+[other])])
    tracker = Tracker(config=TEST_DEFAULTS,core=core)
    result = tracker.track_clip_player(str(path),(0,2),10,[0],.25,0,seed,True,.3,lambda _: None)
    assert result["keyframes"][0]["x"] == seed.x
    assert result["stoppedAtMs"] == expected
    assert tracker.cached_frame(str(path),(0,2),10,[0],.25,0).detections == [other]


def test_track_range_linearly_fills_bounded_detector_misses():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=10, y=20, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[]),
        FrameTrackResult(timestamp_ms=1200.0, detections=[
            BBox(x=18, y=24, w=34, h=44, confidence=0.88, class_id=0, track_id=7),
        ]),
    ]
    tracker = Tracker(config=TEST_DEFAULTS, core=FakeTrackingCore(tracked_frames))

    result = tracker.track_range(
        video_path="/tmp/demo.mp4",
        start_ms=1000.0,
        end_ms=1200.0,
        seed_bbox=BBox(x=10, y=20, w=30, h=40),
        seed_frame_ms=1000.0,
        fps=10.0,
    )

    assert result["keyframes"] == [
        {"tMs": 1000.0, "x": 10, "y": 20, "w": 30, "h": 40, "visible": True},
        {"tMs": 1100.0, "x": 14, "y": 22, "w": 32, "h": 42, "visible": True},
        {"tMs": 1200.0, "x": 18, "y": 24, "w": 34, "h": 44, "visible": True},
    ]


def test_track_range_marks_unbounded_gaps_invisible():
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
        {"tMs": 1100.0, "x": 0, "y": 0, "w": 0, "h": 0, "visible": False},
        {"tMs": 1200.0, "x": 0, "y": 0, "w": 0, "h": 0, "visible": False},
        {"tMs": 1300.0, "x": 0, "y": 0, "w": 0, "h": 0, "visible": False},
    ]


def test_track_range_stop_on_loss_returns_only_trusted_prefix_and_loss_time():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=10, y=20, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[
            BBox(x=14, y=22, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1200.0, detections=[]),
        FrameTrackResult(timestamp_ms=1300.0, detections=[]),
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
        stop_on_loss=True,
    )

    assert result["keyframes"] == [
        {"tMs": 1000.0, "x": 10, "y": 20, "w": 30, "h": 40, "visible": True},
        {"tMs": 1100.0, "x": 14, "y": 22, "w": 30, "h": 40, "visible": True},
    ]
    assert result["completed"] is False
    assert result["stoppedAtMs"] == 1200.0


def test_guided_tracking_streams_an_isolated_gap_only_after_reacquisition():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=10, y=20, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[
            BBox(x=14, y=22, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1200.0, detections=[]),
        FrameTrackResult(timestamp_ms=1300.0, detections=[
            BBox(x=18, y=24, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
    ]
    core = IncrementalFakeTrackingCore(tracked_frames)
    tracker = Tracker(config=TEST_DEFAULTS, core=core)

    progress = []
    result = tracker.track_range(
        video_path="/tmp/demo.mp4",
        start_ms=1000.0,
        end_ms=1300.0,
        seed_bbox=BBox(x=10, y=20, w=30, h=40),
        seed_frame_ms=1000.0,
        fps=10.0,
        stop_on_loss=True,
        progress_callback=lambda keyframe: progress.append((core.processed_frames, keyframe)),
    )

    assert [count for count, _ in progress] == [1, 2, 4, 4]
    assert [kf for _, kf in progress] == result["keyframes"]
    assert result["keyframes"][2] == {
        "tMs": 1200.0, "x": 16, "y": 23, "w": 30, "h": 40, "visible": True,
    }
    assert result["stoppedAtMs"] is None


def _player(x, track_id=7, appearance=(1., 0.)):
    return BBox(x=x, y=20, w=20, h=40, confidence=0.9, class_id=0, track_id=track_id, appearance=appearance)


def test_clip_pass_bridges_ten_missing_frames_on_first_run_and_replay(tmp_path):
    path = tmp_path / "match.mp4"
    path.touch()
    seed = _player(10)
    samples = [[seed], *([[]] * 10), [_player(21, 11)]]
    core = IncrementalFakeTrackingCore([FrameTrackResult(i * 40, boxes) for i, boxes in enumerate(samples)])
    tracker = Tracker(config=TEST_DEFAULTS, core=core)
    for _ in range(2):
        events = []
        result = tracker.track_clip_player(str(path), (0, 12), 25, [0], .25, 0, seed, False, .3, events.append)
        assert result["completed"] and result["stoppedAtMs"] is None
        assert [event["x"] for event in events] == pytest.approx(range(10, 22))
        assert [event["tMs"] for event in events] == list(range(0, 480, 40))
    assert len(core.calls) == 1


@pytest.mark.parametrize("core_type", [FakeTrackingCore, IncrementalFakeTrackingCore])
@pytest.mark.parametrize(("samples", "count", "inspected"), [
    ([[_player(10)], [], [], [], [_player(18, 11)], [_player(20, 11)]], 6, 6),
    ([[_player(10)], *([[]] * 5), [_player(16)]], 7, 7),
    ([[_player(10)], *([[]] * 10), [_player(21, 11)]], 12, 12),
    ([[_player(10)], *([[]] * 11), [_player(22)]], 1, 12),
    ([[_player(10)], *([[]] * 9), [_player(20), _player(28, 8)]], 1, 11),
    ([[_player(10)], [], []], 1, 3),
    ([[_player(10), _player(34, 8)], [], [_player(12)]], 1, 2),
    ([[_player(10)], [], [_player(12), _player(36, 8)], [_player(13)]], 1, 3),
    ([[_player(10)], [], [_player(12, appearance=(0., 1.))], [_player(13)]], 1, 3),
    ([[_player(10), _player(80, 8)], [], [_player(12, 8)]], 1, 3),
    ([[_player(10)], [], [_player(95)], []], 1, 4),
], ids=["three-misses-new-id", "five-misses", "ten-misses-new-id", "eleven-misses-expired",
        "crowded-late-return", "clip-ended", "crowded-before",
        "crowded-after", "wrong-kit", "other-known-track", "distant-player"])
def test_guided_lookahead_limits(core_type, samples, count, inspected):
    frames = [FrameTrackResult(i * 40., boxes) for i, boxes in enumerate(samples)]
    core = core_type(frames)
    progress = []
    result = Tracker(config=TEST_DEFAULTS, core=core).track_range(
        "/tmp/demo.mp4", 0, frames[-1].timestamp_ms, samples[0][0], 0, fps=25,
        stop_on_loss=True, progress_callback=progress.append,
    )
    assert progress == result["keyframes"]
    assert [kf["tMs"] for kf in progress] == [frame.timestamp_ms for frame in frames[:count]]
    assert result["completed"] == (count == len(frames))
    assert result["stoppedAtMs"] == (None if count == len(frames) else frames[count].timestamp_ms)
    if isinstance(core, IncrementalFakeTrackingCore):
        assert core.processed_frames == inspected


def test_track_range_streams_each_trusted_frame_during_incremental_tracking():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=10, y=20, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[
            BBox(x=14, y=22, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1200.0, detections=[]),
    ]
    tracker = Tracker(config=TEST_DEFAULTS, core=IncrementalFakeTrackingCore(tracked_frames))
    progress: list[dict] = []

    result = tracker.track_range(
        video_path="/tmp/demo.mp4",
        start_ms=1000.0,
        end_ms=1200.0,
        seed_bbox=BBox(x=10, y=20, w=30, h=40),
        seed_frame_ms=1000.0,
        fps=10.0,
        stop_on_loss=True,
        progress_callback=progress.append,
    )

    assert progress == result["keyframes"]
    assert [keyframe["tMs"] for keyframe in progress] == [1000.0, 1100.0]


def test_track_range_stop_on_loss_reports_clip_completion():
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=10, y=20, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[
            BBox(x=14, y=22, w=30, h=40, confidence=0.9, class_id=0, track_id=7),
        ]),
    ]
    tracker = Tracker(config=TEST_DEFAULTS, core=FakeTrackingCore(tracked_frames))

    result = tracker.track_range(
        video_path="/tmp/demo.mp4",
        start_ms=1000.0,
        end_ms=1100.0,
        seed_bbox=BBox(x=10, y=20, w=30, h=40),
        seed_frame_ms=1000.0,
        fps=10.0,
        stop_on_loss=True,
    )

    assert result["completed"] is True
    assert result["stoppedAtMs"] is None


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


def test_seed_matching_does_not_snap_to_a_distant_player():
    tracker = Tracker(config=TEST_DEFAULTS, core=FakeTrackingCore([]))

    match = tracker.match_seed_bbox(
        [BBox(x=400, y=300, w=30, h=80, confidence=0.9, class_id=0, track_id=4)],
        BBox(x=20, y=20, w=20, h=12),
        iou_threshold=0.15,
    )

    assert match is None


def test_track_range_uses_appearance_to_avoid_cross_team_switches():
    yellow = (1.0, 0.0)
    blue = (0.0, 1.0)
    tracked_frames = [
        FrameTrackResult(timestamp_ms=1000.0, detections=[
            BBox(x=100, y=70, w=34, h=92, confidence=0.9, class_id=0, track_id=7, appearance=yellow),
        ]),
        FrameTrackResult(timestamp_ms=1100.0, detections=[
            BBox(x=102, y=71, w=34, h=92, confidence=0.95, class_id=0, track_id=3, appearance=blue),
            BBox(x=110, y=72, w=34, h=92, confidence=0.8, class_id=0, track_id=9, appearance=yellow),
        ]),
        FrameTrackResult(timestamp_ms=1200.0, detections=[
            BBox(x=114, y=73, w=34, h=92, confidence=0.82, class_id=0, track_id=9, appearance=yellow),
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

    assert [keyframe["x"] for keyframe in result["keyframes"]] == [100, 110, 114]


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

    assert result["trackId"] == 9
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
