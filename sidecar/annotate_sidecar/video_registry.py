"""Temporary video file registry for browser-uploaded clip videos.

The clip editor can upload a video file once and receive a short-lived `videoRef`.
Tracking and homography routes can then resolve that reference to a local
filesystem path without requiring an external project-root setting.
"""

from __future__ import annotations

import logging
import os
import tempfile
import uuid
from pathlib import Path
from typing import Optional

logger = logging.getLogger("annotate_sidecar.video_registry")

# videoRef -> absolute temp file path
_registry: dict[str, str] = {}
_external: set[str] = set()


def register_video_file(filename: Optional[str], data: bytes) -> str:
    """Persist uploaded video bytes to a temp file and return a videoRef token."""
    suffix = Path(filename or "video.mp4").suffix or ".mp4"
    video_ref = uuid.uuid4().hex[:16]

    with tempfile.NamedTemporaryFile(
        prefix=f"annotate_video_{video_ref}_",
        suffix=suffix,
        delete=False,
    ) as tmp:
        tmp.write(data)
        temp_path = tmp.name

    _registry[video_ref] = temp_path
    logger.info("Registered videoRef %s -> %s", video_ref, temp_path)
    return video_ref


def register_video_path(path: str | Path, *, owned: bool = True) -> str:
    """Register a file; owned=False keeps native project sources on unregister."""
    source = Path(path).resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Video file does not exist: {source}")
    video_ref = uuid.uuid4().hex[:16]
    _registry[video_ref] = str(source)
    if not owned:
        _external.add(video_ref)
    logger.info("Registered videoRef %s -> %s", video_ref, source)
    return video_ref


def resolve_video_ref(video_ref: Optional[str]) -> Optional[str]:
    """Return the absolute temp file path for a registered videoRef, if present."""
    if not video_ref:
        return None
    path = _registry.get(video_ref)
    if not path:
        return None
    if not Path(path).exists():
        # Stale entry, clean it up.
        _registry.pop(video_ref, None)
        _external.discard(video_ref)
        return None
    return path


def unregister_video_ref(video_ref: str) -> bool:
    """Remove a reference, deleting only temporary files owned by the registry."""
    path = _registry.pop(video_ref, None)
    if not path:
        return False

    if video_ref in _external:
        _external.discard(video_ref)
        return True

    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except Exception as exc:  # pragma: no cover - non-critical cleanup warning
        logger.warning("Failed deleting temp video %s: %s", path, exc)
    return True


def cleanup_registered_videos() -> None:
    """Delete all currently registered temporary videos."""
    refs = list(_registry.keys())
    for ref in refs:
        unregister_video_ref(ref)
