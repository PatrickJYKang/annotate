from __future__ import annotations

from pathlib import Path
import tempfile
import uuid


def get_tracking_debug_dir() -> Path:
    path = Path(tempfile.gettempdir()) / "annotate_tracking_debug"
    path.mkdir(parents=True, exist_ok=True)
    return path


def create_tracking_debug_path() -> Path:
    return get_tracking_debug_dir() / f"tracking_debug_{uuid.uuid4().hex}.mp4"


def resolve_tracking_debug_artifact(artifact_name: str) -> Path | None:
    safe_name = Path(artifact_name).name
    if safe_name != artifact_name:
        return None
    path = get_tracking_debug_dir() / safe_name
    if not path.exists() or not path.is_file():
        return None
    return path
