"""Authoritative video metadata for frame-native project storage."""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path
from typing import Literal, TypedDict


class VideoProbeMetadata(TypedDict):
    fps: float
    fps_numerator: int
    fps_denominator: int
    frame_count: int
    frame_count_source: Literal["container", "count"]
    width: int
    height: int
    duration_ms: float
    codec_name: str
    pixel_format: str
    audio_codec_name: str | None
    format_name: str
    constant_frame_rate: bool


def _parse_rate(value: object) -> tuple[int, int, float]:
    if not isinstance(value, str) or not value or value == "0/0":
        return 0, 1, 0.0
    try:
        if "/" in value:
            numerator_raw, denominator_raw = value.split("/", 1)
            numerator = int(numerator_raw)
            denominator = int(denominator_raw)
        else:
            parsed = float(value)
            if not math.isfinite(parsed) or parsed <= 0:
                return 0, 1, 0.0
            numerator = round(parsed * 1_000_000)
            denominator = 1_000_000
        if numerator <= 0 or denominator <= 0:
            return 0, 1, 0.0
        divisor = math.gcd(numerator, denominator)
        numerator //= divisor
        denominator //= divisor
        return numerator, denominator, numerator / denominator
    except (TypeError, ValueError, ZeroDivisionError):
        return 0, 1, 0.0


def _positive_int(value: object) -> int:
    try:
        parsed = int(str(value))
        return parsed if parsed > 0 else 0
    except (TypeError, ValueError):
        return 0


def _run_ffprobe(path: Path, *, count_frames: bool) -> dict[str, object]:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return {}
    command = [ffprobe, "-v", "error"]
    if count_frames:
        command.extend(["-select_streams", "v:0", "-count_frames"])
    command.extend([
        "-show_entries",
        (
            "stream=index,codec_type,codec_name,pix_fmt,width,height,"
            "avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames:"
            "format=format_name,duration"
        ),
        "-of", "json",
        str(path),
    ])
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=1800 if count_frames else 60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {(result.stderr or result.stdout).strip()}")
    try:
        payload = json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError) as error:
        raise RuntimeError("ffprobe returned invalid metadata JSON") from error
    return payload if isinstance(payload, dict) else {}


def _decode_count(path: Path) -> tuple[int, float, int, int]:
    try:
        import cv2
    except ImportError as error:
        raise RuntimeError(
            "ffprobe did not return a frame count and OpenCV is unavailable for explicit counting"
        ) from error

    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not decode video for frame count: {path}")
    count = 0
    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        while True:
            ok, _frame = capture.read()
            if not ok:
                break
            count += 1
    finally:
        capture.release()
    return count, fps, width, height


def _first_stream(payload: dict[str, object], stream_type: str) -> dict[str, object]:
    streams = payload.get("streams", [])
    if not isinstance(streams, list):
        return {}
    for stream in streams:
        if isinstance(stream, dict) and stream.get("codec_type") == stream_type:
            return stream
    if stream_type == "video":
        return next((stream for stream in streams if isinstance(stream, dict)), {})
    return {}


def probe_video_metadata(video_path: str) -> VideoProbeMetadata:
    """Read exact metadata, using the container frame count before scanning packets."""
    path = Path(video_path)
    if not path.is_file():
        raise FileNotFoundError(f"Video not found: {video_path}")

    payload = _run_ffprobe(path, count_frames=False)
    video_stream = _first_stream(payload, "video")
    audio_stream = _first_stream(payload, "audio")
    frame_count = _positive_int(video_stream.get("nb_frames"))
    frame_count_source: Literal["container", "count"] = "container"

    avg_numerator, avg_denominator, avg_fps = _parse_rate(video_stream.get("avg_frame_rate"))
    rate_numerator, rate_denominator, nominal_fps = _parse_rate(video_stream.get("r_frame_rate"))
    fps_numerator = avg_numerator or rate_numerator
    fps_denominator = avg_denominator if avg_numerator else rate_denominator
    fps = avg_fps or nominal_fps
    width = _positive_int(video_stream.get("width"))
    height = _positive_int(video_stream.get("height"))

    if frame_count <= 0 and payload:
        counted_payload = _run_ffprobe(path, count_frames=True)
        counted_stream = _first_stream(counted_payload, "video")
        frame_count = _positive_int(counted_stream.get("nb_read_frames"))
        frame_count_source = "count"

    if frame_count <= 0 or fps <= 0 or width <= 0 or height <= 0:
        decoded_count, decoded_fps, decoded_width, decoded_height = _decode_count(path)
        if frame_count <= 0:
            frame_count = decoded_count
            frame_count_source = "count"
        if fps <= 0 and decoded_fps > 0:
            fps = decoded_fps
            fps_numerator, fps_denominator, _ = _parse_rate(str(decoded_fps))
        width = width or decoded_width
        height = height or decoded_height

    if frame_count <= 0:
        raise RuntimeError("Video contains no decodable frames")
    if fps <= 0 or width <= 0 or height <= 0:
        raise RuntimeError("Video probe could not determine fps or dimensions")

    constant_frame_rate = (
        avg_fps <= 0
        or nominal_fps <= 0
        or math.isclose(avg_fps, nominal_fps, rel_tol=1e-6, abs_tol=1e-6)
    )
    format_payload = payload.get("format", {})
    format_name = format_payload.get("format_name", "") if isinstance(format_payload, dict) else ""
    return {
        "fps": fps,
        "fps_numerator": fps_numerator,
        "fps_denominator": fps_denominator,
        "frame_count": frame_count,
        "frame_count_source": frame_count_source,
        "width": width,
        "height": height,
        "duration_ms": (frame_count * 1000.0) / fps,
        "codec_name": str(video_stream.get("codec_name") or ""),
        "pixel_format": str(video_stream.get("pix_fmt") or ""),
        "audio_codec_name": str(audio_stream.get("codec_name")) if audio_stream.get("codec_name") else None,
        "format_name": str(format_name or ""),
        "constant_frame_rate": constant_frame_rate,
    }
