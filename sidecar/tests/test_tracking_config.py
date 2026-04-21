from annotate_sidecar.config.tracking import get_tracking_defaults


def test_tracking_defaults_use_expected_app_baseline(monkeypatch):
    for key in (
        "ANNOTATE_TRACKING_MODEL",
        "ANNOTATE_TRACKING_SAMPLE_FPS",
        "ANNOTATE_TRACKING_CLASSES",
        "ANNOTATE_TRACKING_CONF_THRESHOLD",
        "ANNOTATE_TRACKING_IOU_THRESHOLD",
        "ANNOTATE_TRACKING_TRACK_BUFFER",
        "ANNOTATE_TRACKING_MIN_CONSECUTIVE_FRAMES",
        "ANNOTATE_TRACKING_DIRECTION_WEIGHT",
        "ANNOTATE_TRACKING_HIGH_CONF_THRESHOLD",
        "ANNOTATE_TRACKING_DELTA_T",
    ):
        monkeypatch.delenv(key, raising=False)
    get_tracking_defaults.cache_clear()

    defaults = get_tracking_defaults()

    assert defaults.detector_model_name == "yolov8n.pt"
    assert defaults.sample_fps == 30.0
    assert defaults.classes == (0,)
    assert defaults.conf_threshold == 0.25
    assert defaults.iou_threshold == 0.15
    assert defaults.track_buffer_frames == 30
    assert defaults.minimum_consecutive_frames == 1
    assert defaults.direction_consistency_weight == 0.2
    assert defaults.high_conf_det_threshold == 0.25
    assert defaults.delta_t == 3


def test_tracking_defaults_allow_sidecar_level_env_overrides(monkeypatch):
    monkeypatch.setenv("ANNOTATE_TRACKING_MODEL", "rfdetr-nano.pt")
    monkeypatch.setenv("ANNOTATE_TRACKING_SAMPLE_FPS", "12.5")
    monkeypatch.setenv("ANNOTATE_TRACKING_CLASSES", "0,32")
    monkeypatch.setenv("ANNOTATE_TRACKING_CONF_THRESHOLD", "0.41")
    monkeypatch.setenv("ANNOTATE_TRACKING_IOU_THRESHOLD", "0.66")
    monkeypatch.setenv("ANNOTATE_TRACKING_TRACK_BUFFER", "17")
    monkeypatch.setenv("ANNOTATE_TRACKING_MIN_CONSECUTIVE_FRAMES", "2")
    monkeypatch.setenv("ANNOTATE_TRACKING_DIRECTION_WEIGHT", "0.33")
    monkeypatch.setenv("ANNOTATE_TRACKING_HIGH_CONF_THRESHOLD", "0.51")
    monkeypatch.setenv("ANNOTATE_TRACKING_DELTA_T", "5")
    get_tracking_defaults.cache_clear()

    defaults = get_tracking_defaults()

    assert defaults.detector_model_name == "rfdetr-nano.pt"
    assert defaults.sample_fps == 12.5
    assert defaults.classes == (0, 32)
    assert defaults.conf_threshold == 0.41
    assert defaults.iou_threshold == 0.66
    assert defaults.track_buffer_frames == 17
    assert defaults.minimum_consecutive_frames == 2
    assert defaults.direction_consistency_weight == 0.33
    assert defaults.high_conf_det_threshold == 0.51
    assert defaults.delta_t == 5
