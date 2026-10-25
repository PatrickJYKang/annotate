"""Load YOLO with Annotate-owned settings before prediction callbacks initialize."""

from __future__ import annotations

import importlib
import os
from pathlib import Path
import sys
from threading import Lock
from types import ModuleType

_load_lock = Lock()


def _config_root() -> Path:
    if override := os.environ.get("ANNOTATE_ULTRALYTICS_CONFIG_DIR"):
        return Path(override).expanduser().resolve()
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return (base / "Annotate" / "sidecar" / "ultralytics").resolve()


def _require_private_settings(settings, expected_file: Path) -> None:
    if Path(settings.file).resolve() != expected_file:
        raise RuntimeError("Ultralytics was initialized outside Annotate's settings directory; restart the sidecar.")


def load_ultralytics() -> ModuleType:
    """Use for both capability checks and model loading, not a direct YOLO import."""
    with _load_lock:
        root = _config_root()
        # Ultralytics appends this subdirectory even when YOLO_CONFIG_DIR is set.
        config_dir = root / "Ultralytics"
        settings_file = config_dir / "settings.json"
        if utils := sys.modules.get("ultralytics.utils"):
            _require_private_settings(utils.SETTINGS, settings_file)

        # Pre-create the directory to prevent the library's shared /tmp fallback.
        config_dir.mkdir(parents=True, exist_ok=True)
        os.environ["YOLO_CONFIG_DIR"] = str(root)
        module = importlib.import_module("ultralytics")
        _require_private_settings(module.settings, settings_file)
        # In pinned 8.4.19, YOLO/models/events are lazy. Sentry is yolo-CLI-only,
        # not used by our Python entry point. Set these before accessing YOLO.
        if any(module.settings.get(key) is not False for key in ("sync", "hub")):
            module.settings.update({"sync": False, "hub": False})
        return module
