import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from annotate_sidecar import ultralytics_runtime as runtime


@pytest.mark.parametrize("platform,variable,base", [
    ("darwin", None, "Library/Application Support"),
    ("win32", None, "AppData/Roaming"),
    ("win32", "APPDATA", "roaming"),
    ("linux", None, ".config"),
    ("linux", "XDG_CONFIG_HOME", "config"),
])
def test_default_config_is_annotate_owned(tmp_path, monkeypatch, platform, variable, base):
    monkeypatch.delenv("ANNOTATE_ULTRALYTICS_CONFIG_DIR", raising=False)
    monkeypatch.delenv("APPDATA", raising=False)
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    monkeypatch.setenv("YOLO_CONFIG_DIR", str(tmp_path / "unrelated"))
    monkeypatch.setattr(runtime.sys, "platform", platform)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    if variable:
        monkeypatch.setenv(variable, str(tmp_path / base))
    assert runtime._config_root() == tmp_path / base / "Annotate/sidecar/ultralytics"


class Settings(dict):
    def __init__(self, file):
        super().__init__(sync=True, hub=True, uuid="existing-id", weights_dir="custom-weights")
        self.file = file
        self.writes = 0

    def update(self, values):
        self.writes += 1
        super().update(values)


def test_loader_sets_flags_before_yolo_and_does_not_rewrite_on_health_polls(tmp_path, monkeypatch):
    root = tmp_path / "app/settings/ultralytics"
    monkeypatch.setenv("ANNOTATE_ULTRALYTICS_CONFIG_DIR", str(root))
    monkeypatch.setenv("YOLO_CONFIG_DIR", str(tmp_path / "unrelated"))
    monkeypatch.delitem(sys.modules, "ultralytics.utils", raising=False)
    settings = Settings(root / "Ultralytics/settings.json")
    module = SimpleNamespace(settings=settings)

    def import_module(name):
        assert name == "ultralytics"
        assert settings.file.parent.is_dir()
        assert os.environ["YOLO_CONFIG_DIR"] == str(root)
        return module

    monkeypatch.setattr(runtime.importlib, "import_module", import_module)
    assert runtime.load_ultralytics() is module
    assert runtime.load_ultralytics() is module
    assert settings == dict(sync=False, hub=False, uuid="existing-id", weights_dir="custom-weights")
    assert settings.writes == 1


def test_preimported_foreign_settings_are_not_changed(tmp_path, monkeypatch):
    settings = Settings(tmp_path / "other/Ultralytics/settings.json")
    monkeypatch.setenv("ANNOTATE_ULTRALYTICS_CONFIG_DIR", str(tmp_path / "app"))
    monkeypatch.setenv("YOLO_CONFIG_DIR", str(tmp_path / "other"))
    monkeypatch.setitem(sys.modules, "ultralytics.utils", SimpleNamespace(SETTINGS=settings))
    with pytest.raises(RuntimeError, match="outside Annotate"):
        runtime.load_ultralytics()
    assert settings["sync"] is True and settings["hub"] is True
    assert settings.writes == 0
    assert not (tmp_path / "app").exists()
    assert os.environ["YOLO_CONFIG_DIR"] == str(tmp_path / "other")


def test_unusable_directory_fails_before_import_instead_of_using_shared_fallback(tmp_path, monkeypatch):
    root = tmp_path / "app"
    root.write_text("not a directory")
    monkeypatch.setenv("ANNOTATE_ULTRALYTICS_CONFIG_DIR", str(root))
    monkeypatch.delitem(sys.modules, "ultralytics.utils", raising=False)
    importer = Mock()
    monkeypatch.setattr(runtime.importlib, "import_module", importer)
    with pytest.raises(OSError):
        runtime.load_ultralytics()
    importer.assert_not_called()


def test_capability_and_tracking_entry_points_use_private_loader(monkeypatch):
    from annotate_sidecar.routes import health
    from annotate_sidecar.vendor.trackers.core import ultralytics_ocsort

    loader = Mock(return_value=SimpleNamespace(YOLO=Mock()))
    monkeypatch.setattr(health, "load_ultralytics", loader)
    monkeypatch.setattr(ultralytics_ocsort, "load_ultralytics", loader)
    assert health._check_model_importable("ultralytics")
    core = ultralytics_ocsort.UltralyticsOCSORTCore("local-model.pt")
    core._load_model()
    core._load_model()
    assert loader.call_count == 2
    loader.return_value.YOLO.assert_called_once_with("local-model.pt")
    loader.side_effect = RuntimeError("private settings unavailable")
    assert not health._check_model_importable("ultralytics")


# Separate interpreter: real library imports, with no pytest/offline exemptions
# masking the analytics flag. Block network at the socket boundary throughout.
PRIVACY_PROBE = r'''
import json, os, socket, sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

connections = []
def audit(event, args):
    if event == "socket.connect":
        connections.append(repr(args))
        raise RuntimeError("Network is blocked in the privacy regression test")
sys.addaudithook(audit)
original_resolver = socket.getaddrinfo
socket.getaddrinfo = lambda host, *args, **kwargs: [] if host in ("one.one.one.one", "dns.google") else original_resolver(host, *args, **kwargs)
sentry = SimpleNamespace(init=Mock(), set_user=Mock())
sys.modules["sentry_sdk"] = sentry

from annotate_sidecar.ultralytics_runtime import load_ultralytics
ultralytics = load_ultralytics()
assert "ultralytics.utils.events" not in sys.modules, "Analytics initialized before privacy settings"
assert "ultralytics.models" not in sys.modules
assert ultralytics.settings["sync"] is False and ultralytics.settings["hub"] is False
assert os.environ.get("YOLO_OFFLINE") != "true"
import ultralytics.utils as utils
assert utils.ONLINE is True
utils.TESTS_RUNNING = False
utils.IS_PIP_PACKAGE = True
utils.RANK = -1

from ultralytics.utils import events as analytics
assert analytics.TESTS_RUNNING is False and analytics.ONLINE is True and analytics.IS_PIP_PACKAGE is True
assert analytics.events.enabled is False
thread = Mock(side_effect=AssertionError("Analytics attempted to send an event"))
analytics.Thread = thread
YOLO = ultralytics.YOLO
from ultralytics.utils.callbacks import hub
assert hub.callbacks == {}
args = SimpleNamespace(mode="predict", task="detect", model="yolov8n.pt")
hub.on_predict_start(SimpleNamespace(args=args, device="cpu"))
assert analytics.events.events == []
thread.assert_not_called()
sentry.init.assert_not_called()
sentry.set_user.assert_not_called()

# Model download dispatch must still work; intercept the transfer, not its gate.
from ultralytics.utils import downloads
with patch.object(downloads, "safe_download") as transfer:
    downloads.attempt_download_asset(Path(os.environ["ANNOTATE_ULTRALYTICS_CONFIG_DIR"]) / "missing/yolov8n.pt")
    transfer.assert_called_once()
    assert transfer.call_args.kwargs["url"].endswith("/yolov8n.pt")
assert connections == [], connections
print("PRIVACY_OK=" + json.dumps(dict(ultralytics.settings)))
'''


def _probe(tmp_path):
    environment = {
        **os.environ,
        "ANNOTATE_ULTRALYTICS_CONFIG_DIR": str(tmp_path / "app/settings/ultralytics"),
        "YOLO_CONFIG_DIR": str(tmp_path / "unrelated"),
        "YOLO_OFFLINE": "false",
        "MPLCONFIGDIR": str(tmp_path / "matplotlib"),
    }
    result = subprocess.run(
        [sys.executable, "-c", PRIVACY_PROBE],
        cwd=Path(__file__).resolve().parents[1],
        env=environment, capture_output=True, text=True, timeout=90,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads(next(line.split("=", 1)[1] for line in result.stdout.splitlines() if line.startswith("PRIVACY_OK=")))


def test_real_library_fresh_existing_and_reset_profiles(tmp_path):
    foreign_file = tmp_path / "unrelated/Ultralytics/settings.json"
    foreign_file.parent.mkdir(parents=True)
    foreign_file.write_text('{"sync": true, "hub": true, "uuid": "unrelated"}')
    foreign_before = foreign_file.read_bytes()

    fresh = _probe(tmp_path)
    settings_file = tmp_path / "app/settings/ultralytics/Ultralytics/settings.json"
    assert json.loads(settings_file.read_text()) == fresh

    existing = {**fresh, "sync": True, "hub": True, "weights_dir": str(tmp_path / "custom-weights")}
    settings_file.write_text(json.dumps(existing))
    updated = _probe(tmp_path)
    assert updated == {**existing, "sync": False, "hub": False}
    assert json.loads(settings_file.read_text()) == updated

    settings_file.write_text("{invalid json")
    reset = _probe(tmp_path)
    assert reset["sync"] is False and reset["hub"] is False
    assert json.loads(settings_file.read_text()) == reset
    assert foreign_file.read_bytes() == foreign_before
