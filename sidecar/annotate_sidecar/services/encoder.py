"""
Video encoding service — ffmpeg MP4 encoding.

Takes a directory of sequentially-numbered frame images and encodes
them into an MP4 using ffmpeg.
"""

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Sequence

logger = logging.getLogger("annotate_sidecar.encoder")


def check_ffmpeg() -> bool:
    """Return True if ffmpeg is available on PATH."""
    return shutil.which("ffmpeg") is not None


def _tail_text(value: str | bytes | None, limit: int = 4000) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    return value[-limit:] if value else None


def _run_ffmpeg(cmd: Sequence[str], *, label: str, timeout: int) -> subprocess.CompletedProcess[str]:
    logger.info("Running ffmpeg %s: %s", label, " ".join(cmd))
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as error:
        stdout_tail = _tail_text(error.stdout)
        stderr_tail = _tail_text(error.stderr)
        logger.error("ffmpeg %s timed out after %ss", label, timeout)
        if stdout_tail:
            logger.error("ffmpeg %s stdout (tail):\n%s", label, stdout_tail)
        if stderr_tail:
            logger.error("ffmpeg %s stderr (tail):\n%s", label, stderr_tail)
        raise RuntimeError(f"ffmpeg {label} timed out after {timeout}s") from error

    if result.returncode != 0:
        stdout_tail = _tail_text(result.stdout)
        stderr_tail = _tail_text(result.stderr)
        logger.error("ffmpeg %s failed with exit code %s", label, result.returncode)
        if stdout_tail:
            logger.error("ffmpeg %s stdout (tail):\n%s", label, stdout_tail)
        if stderr_tail:
            logger.error("ffmpeg %s stderr (tail):\n%s", label, stderr_tail)
        raise RuntimeError(
            f"ffmpeg {label} exited with code {result.returncode}: "
            f"{stderr_tail or stdout_tail or 'no ffmpeg output captured'}"
        )

    return result


def encode_frames(
    frames_dir: str,
    output_path: str,
    fps: float = 30.0,
    pattern: str = "frame_%06d.jpg",
    crf: int = 18,
) -> str:
    """
    Encode numbered frame images into an MP4 video.

    Args:
        frames_dir: Directory containing the frame images.
        output_path: Path for the output MP4 file.
        fps: Frame rate for the output video.
        pattern: Frame filename pattern (printf-style).
        crf: Constant Rate Factor (0–51, lower = better quality).

    Returns:
        Absolute path to the output MP4.

    Raises:
        FileNotFoundError: If ffmpeg is not found or frames_dir doesn't exist.
        RuntimeError: If ffmpeg exits with a non-zero code.
    """
    if not check_ffmpeg():
        raise FileNotFoundError(
            "ffmpeg not found on PATH. Install ffmpeg to enable export."
        )

    frames_path = Path(frames_dir)
    if not frames_path.is_dir():
        raise FileNotFoundError(f"Frames directory not found: {frames_dir}")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg",
        "-y",  # overwrite output
        "-framerate", str(fps),
        "-i", str(frames_path / pattern),
        "-c:v", "libx264",
        "-crf", str(crf),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(out),
    ]

    _run_ffmpeg(cmd, label="frame export", timeout=600)

    logger.info(
        "Encoded %s (%.1f fps) → %s (%s bytes)",
        frames_dir,
        fps,
        out,
        out.stat().st_size if out.exists() else "missing",
    )
    return str(out.resolve())


def encode_exact_motion_segment(
    video_path: str,
    output_path: str,
    start_ms: float,
    end_ms: float,
) -> str:
    if not check_ffmpeg():
        raise FileNotFoundError(
            "ffmpeg not found on PATH. Install ffmpeg to enable derived-media encoding."
        )

    if end_ms <= start_ms:
        raise ValueError("end_ms must be greater than start_ms")

    source = Path(video_path)
    if not source.is_file():
        raise FileNotFoundError(f"Video not found: {video_path}")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    start_seconds = max(0.0, start_ms / 1000.0)
    duration_seconds = max(0.001, (end_ms - start_ms) / 1000.0)
    cmd = [
        "ffmpeg",
        "-y",
        "-ss", f"{start_seconds:.3f}",
        "-i", str(source),
        "-t", f"{duration_seconds:.3f}",
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        str(out),
    ]

    _run_ffmpeg(cmd, label="exact-motion encode", timeout=600)

    logger.info(
        "Encoded exact-motion segment %s [%.1fms, %.1fms] → %s (%s bytes)",
        source,
        start_ms,
        end_ms,
        out,
        out.stat().st_size if out.exists() else "missing",
    )
    return str(out.resolve())
