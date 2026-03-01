"""
Project root resolution utility.

Stores the project root path and resolves relative video paths against it.
Separated from server.py to avoid circular imports with route modules.
"""

from pathlib import Path
from typing import Optional


# Module-level storage for the project root path
_project_root: Optional[str] = None


def get_project_root() -> Optional[str]:
    return _project_root


def set_project_root(root: Optional[str]) -> None:
    global _project_root
    _project_root = root


def resolve_video_path(video_path: str) -> str:
    """Resolve a video path against the project root if it is relative."""
    p = Path(video_path)
    if p.is_absolute():
        return video_path
    root = _project_root
    if root:
        resolved = Path(root) / video_path
        if resolved.exists():
            return str(resolved)
    return video_path
