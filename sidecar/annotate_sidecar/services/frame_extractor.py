"""
Frame extraction service — uses OpenCV to extract frames from video files.

Provides:
  - extract_frame(video_path, frame_ms) → np.ndarray
  - extract_frames(video_path, start_ms, end_ms, fps) → Iterator[(ms, np.ndarray)]
  - close_all_captures() — release cached VideoCapture objects
"""

import logging
import threading
from pathlib import Path
from typing import Iterator, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger("annotate_sidecar.frame_extractor")

# ---------------------------------------------------------------------------
# VideoCapture cache — avoid re-opening the same video repeatedly
# ---------------------------------------------------------------------------

_capture_cache: dict[str, cv2.VideoCapture] = {}
_cache_lock = threading.Lock()


def _get_capture(video_path: str) -> cv2.VideoCapture:
    """Get or create a cached VideoCapture for the given path."""
    resolved = str(Path(video_path).resolve())
    with _cache_lock:
        cap = _capture_cache.get(resolved)
        if cap is not None and cap.isOpened():
            return cap
        # Open new capture
        cap = cv2.VideoCapture(resolved)
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {video_path}")
        _capture_cache[resolved] = cap
        logger.debug("Opened VideoCapture for %s", resolved)
        return cap


def close_all_captures() -> None:
    """Release all cached VideoCapture objects. Called on shutdown."""
    with _cache_lock:
        for path, cap in _capture_cache.items():
            try:
                cap.release()
                logger.debug("Released VideoCapture for %s", path)
            except Exception:
                pass
        _capture_cache.clear()


def close_capture(video_path: str) -> None:
    """Release a specific cached VideoCapture."""
    resolved = str(Path(video_path).resolve())
    with _cache_lock:
        cap = _capture_cache.pop(resolved, None)
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Frame extraction
# ---------------------------------------------------------------------------


def extract_frame(video_path: str, frame_ms: float) -> np.ndarray:
    """
    Extract a single frame from a video at the given millisecond timestamp.

    Args:
        video_path: Path to the video file.
        frame_ms: Timestamp in milliseconds.

    Returns:
        BGR numpy array of the frame.

    Raises:
        FileNotFoundError: If the video cannot be opened.
        RuntimeError: If the frame cannot be read.
    """
    cap = _get_capture(video_path)

    with _cache_lock:
        cap.set(cv2.CAP_PROP_POS_MSEC, frame_ms)
        ret, frame = cap.read()

    if not ret or frame is None:
        # Try seeking to nearest keyframe and reading forward
        logger.warning(
            "Failed to read frame at %.1fms from %s, trying nearest keyframe",
            frame_ms,
            video_path,
        )
        with _cache_lock:
            # Seek slightly before and read forward
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0, frame_ms - 100))
            ret, frame = cap.read()
            if not ret or frame is None:
                raise RuntimeError(
                    f"Cannot read frame at {frame_ms}ms from {video_path}"
                )

    return frame


def extract_frames(
    video_path: str,
    start_ms: float,
    end_ms: float,
    fps: float,
) -> Iterator[Tuple[float, np.ndarray]]:
    """
    Yield frames from a video at regular intervals.

    Args:
        video_path: Path to the video file.
        start_ms: Start timestamp in milliseconds.
        end_ms: End timestamp in milliseconds.
        fps: Desired frame rate for extraction.

    Yields:
        (timestamp_ms, bgr_frame) tuples.
    """
    if fps <= 0:
        raise ValueError("fps must be positive")
    if end_ms <= start_ms:
        raise ValueError("end_ms must be greater than start_ms")

    interval_ms = 1000.0 / fps
    t = start_ms

    while t <= end_ms:
        try:
            frame = extract_frame(video_path, t)
            yield (t, frame)
        except RuntimeError as e:
            logger.warning("Skipping frame at %.1fms: %s", t, e)
        t += interval_ms


def get_video_info(video_path: str) -> dict:
    """
    Get basic video information.

    Returns:
        Dict with keys: width, height, fps, duration_ms, frame_count
    """
    cap = _get_capture(video_path)
    with _cache_lock:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration_ms = (frame_count / fps * 1000) if fps > 0 else 0

    return {
        "width": width,
        "height": height,
        "fps": fps,
        "duration_ms": duration_ms,
        "frame_count": frame_count,
    }
