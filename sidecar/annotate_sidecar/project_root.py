"""Deprecated compatibility module for legacy project-root imports.

The sidecar no longer supports relative video-path resolution via mutable
project-root state. Callers should use a `videoRef` from `/video/register`,
or pass an absolute `videoPath`.
"""

from pathlib import Path
from typing import Optional


def get_project_root() -> Optional[str]:
    """Legacy API retained for compatibility; project roots are no longer used."""
    return None


def set_project_root(root: Optional[str]) -> None:
    """Legacy API retained for compatibility; project roots are ignored."""
    _ = root


def resolve_video_path(video_path: str) -> str:
    """Validate that `video_path` is absolute.

    Raises:
        ValueError: If `video_path` is relative.
    """
    if Path(video_path).is_absolute():
        return video_path
    raise ValueError(
        "Relative videoPath is unsupported. Register the file via /video/register or use an absolute path."
    )
