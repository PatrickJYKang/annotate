from annotate_sidecar.config.tracking import get_tracking_defaults


def test_tracking_defaults_use_expected_app_baseline(monkeypatch):
    for key in (
        "ANNOTATE_TRACKING_BACKEND",
        "ANNOTATE_TRACKING_MODEL",
        "ANNOTATE_TRACKING_CORE_CONFIG",
        "ANNOTATE_TRACKING_SAMPLE_FPS",
        "ANNOTATE_TRACKING_CLASSES",
        "ANNOTATE_TRACKING_CONF_THRESHOLD",
        "ANNOTATE_TRACKING_IOU_THRESHOLD",
        "ANNOTATE_TRACKING_TRACK_BUFFER",
    ):
        monkeypatch.delenv(key, raising=False)
    get_tracking_defaults.cache_clear()

    defaults = get_tracking_defaults()

    assert defaults.backend == "bytetrack"
    assert defaults.detector_model_name == "yolov8n.pt"
    assert defaults.core_tracker_config == "bytetrack.yaml"
    assert defaults.sample_fps == 30.0
    assert defaults.classes == (0,)
    assert defaults.conf_threshold == 0.25
    assert defaults.iou_threshold == 0.3
    assert defaults.track_buffer_frames == 30


def test_tracking_defaults_allow_sidecar_level_env_overrides(monkeypatch):
    monkeypatch.setenv("ANNOTATE_TRACKING_BACKEND", "ocsort")
    monkeypatch.setenv("ANNOTATE_TRACKING_MODEL", "rfdetr-nano.pt")
    monkeypatch.setenv("ANNOTATE_TRACKING_CORE_CONFIG", "ocsort-demo")
    monkeypatch.setenv("ANNOTATE_TRACKING_SAMPLE_FPS", "12.5")
    monkeypatch.setenv("ANNOTATE_TRACKING_CLASSES", "0,32")
    monkeypatch.setenv("ANNOTATE_TRACKING_CONF_THRESHOLD", "0.41")
    monkeypatch.setenv("ANNOTATE_TRACKING_IOU_THRESHOLD", "0.66")
    monkeypatch.setenv("ANNOTATE_TRACKING_TRACK_BUFFER", "17")
    get_tracking_defaults.cache_clear()

    defaults = get_tracking_defaults()

    assert defaults.backend == "ocsort"
    assert defaults.detector_model_name == "rfdetr-nano.pt"
    assert defaults.core_tracker_config == "ocsort-demo"
    assert defaults.sample_fps == 12.5
    assert defaults.classes == (0, 32)
    assert defaults.conf_threshold == 0.41
    assert defaults.iou_threshold == 0.66
    assert defaults.track_buffer_frames == 17
