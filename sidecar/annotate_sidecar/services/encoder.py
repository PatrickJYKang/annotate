"""
Video encoding service — ffmpeg MP4 encoding.

Takes a directory of sequentially-numbered frame images and encodes
them into an MP4 using ffmpeg.
"""

import logging
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger("annotate_sidecar.encoder")


def check_ffmpeg() -> bool:
    """Return True if ffmpeg is available on PATH."""
    return shutil.which("ffmpeg") is not None


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

    logger.info("Running ffmpeg: %s", " ".join(cmd))
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=600,  # 10 minute timeout
    )

    if result.returncode != 0:
        logger.error("ffmpeg stderr:\n%s", result.stderr[-2000:])
        raise RuntimeError(
            f"ffmpeg exited with code {result.returncode}: "
            f"{result.stderr[-500:]}"
        )

    logger.info("Encoded %s (%.1f fps) → %s", frames_dir, fps, out)
    return str(out.resolve())
