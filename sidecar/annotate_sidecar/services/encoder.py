"""
Video encoding service — ffmpeg MP4 encoding.

Takes a directory of sequentially-numbered frame images and encodes
them into an MP4 using ffmpeg.
"""

import logging
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from functools import lru_cache
from pathlib import Path
from typing import Callable, Sequence

logger = logging.getLogger("annotate_sidecar.encoder")

ProgressCallback = Callable[[float], None]


class EncodingCancelledError(RuntimeError):
    """Raised when a caller cancels a running ffmpeg operation."""


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


@lru_cache(maxsize=8)
def _ffmpeg_encoder_available(name: str) -> bool:
    if not check_ffmpeg():
        return False
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and any(
        line.split()[1:2] == [name]
        for line in result.stdout.splitlines()
    )


def normalization_thread_limit() -> int:
    """Return the bounded software-encode thread count for video import."""
    raw = os.environ.get("ANNOTATE_NORMALIZE_THREADS", "").strip()
    if raw:
        try:
            return max(1, min(16, int(raw)))
        except ValueError:
            logger.warning("Ignoring invalid ANNOTATE_NORMALIZE_THREADS=%r", raw)
    return max(1, min(4, os.cpu_count() or 1))


def select_normalization_encoder(configured: str | None = None) -> str:
    """Choose a low-impact encoder, preferring VideoToolbox on macOS."""
    choice = (configured or os.environ.get("ANNOTATE_NORMALIZE_ENCODER", "auto")).strip().lower()
    if choice == "auto":
        if sys.platform == "darwin" and _ffmpeg_encoder_available("h264_videotoolbox"):
            return "h264_videotoolbox"
        return "libx264"
    if choice not in {"libx264", "h264_videotoolbox"}:
        raise ValueError(
            "ANNOTATE_NORMALIZE_ENCODER must be auto, libx264, or h264_videotoolbox"
        )
    if not _ffmpeg_encoder_available(choice):
        raise FileNotFoundError(f"ffmpeg encoder is unavailable: {choice}")
    return choice


def _probe_duration_seconds(video_path: str) -> float | None:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    try:
        result = subprocess.run(
            [
                ffprobe,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        duration = float(result.stdout.strip())
        return duration if result.returncode == 0 and duration > 0 else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def _terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _run_ffmpeg_with_progress(
    cmd: Sequence[str],
    *,
    label: str,
    timeout: int,
    duration_seconds: float | None,
    progress_callback: ProgressCallback | None,
    cancel_event: threading.Event | None,
) -> None:
    logger.info("Running ffmpeg %s: %s", label, " ".join(cmd))
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    output_queue: queue.Queue[str | None] = queue.Queue()
    stderr_tail: deque[str] = deque(maxlen=160)

    def read_stdout() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            output_queue.put(line.rstrip())
        output_queue.put(None)

    def read_stderr() -> None:
        assert process.stderr is not None
        for line in process.stderr:
            stderr_tail.append(line.rstrip())

    stdout_thread = threading.Thread(target=read_stdout, daemon=True)
    stderr_thread = threading.Thread(target=read_stderr, daemon=True)
    stdout_thread.start()
    stderr_thread.start()
    started_at = time.monotonic()
    stdout_complete = False
    if progress_callback:
        progress_callback(0.0)

    try:
        while True:
            if cancel_event and cancel_event.is_set():
                _terminate_process(process)
                raise EncodingCancelledError(f"ffmpeg {label} was canceled")
            if time.monotonic() - started_at > timeout:
                _terminate_process(process)
                raise RuntimeError(f"ffmpeg {label} timed out after {timeout}s")

            try:
                line = output_queue.get(timeout=0.2)
            except queue.Empty:
                if stdout_complete and process.poll() is not None:
                    break
                continue

            if line is None:
                stdout_complete = True
                if process.poll() is not None:
                    break
                continue

            key, separator, value = line.partition("=")
            if not separator:
                continue
            if key == "out_time_us" and duration_seconds and progress_callback:
                try:
                    processed = max(0.0, int(value) / 1_000_000)
                    progress_callback(min(0.995, processed / duration_seconds))
                except ValueError:
                    pass
            elif key == "progress" and value == "end" and progress_callback:
                progress_callback(1.0)

        return_code = process.wait(timeout=5)
    finally:
        if process.poll() is None:
            _terminate_process(process)
        stdout_thread.join(timeout=1)
        stderr_thread.join(timeout=1)

    if return_code != 0:
        detail = "\n".join(stderr_tail) or "no ffmpeg error output captured"
        logger.error("ffmpeg %s failed with exit code %s\n%s", label, return_code, detail)
        raise RuntimeError(f"ffmpeg {label} exited with code {return_code}: {detail[-4000:]}")


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


def remux_video_for_browser(
    video_path: str,
    output_path: str,
    *,
    audio_codec_name: str | None = None,
    progress_callback: ProgressCallback | None = None,
    cancel_event: threading.Event | None = None,
) -> str:
    """Repackage an already-compatible CFR H.264 stream without re-encoding video."""
    if not check_ffmpeg():
        raise FileNotFoundError("ffmpeg not found on PATH. Install ffmpeg to enable video import.")
    source = Path(video_path)
    if not source.is_file():
        raise FileNotFoundError(f"Video not found: {video_path}")
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    duration_seconds = _probe_duration_seconds(str(source))
    timeout = max(1800, int((duration_seconds or 0) * 1.5 + 300))
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-nostdin",
        "-y",
        "-i", str(source),
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c:v", "copy",
        "-c:a", "copy" if audio_codec_name in {None, "aac", "mp3"} else "aac",
        "-movflags", "+faststart",
        "-avoid_negative_ts", "make_zero",
        "-progress", "pipe:1",
        "-nostats",
        str(out),
    ]
    _run_ffmpeg_with_progress(
        command,
        label="video import remux",
        timeout=timeout,
        duration_seconds=duration_seconds,
        progress_callback=progress_callback,
        cancel_event=cancel_event,
    )
    return str(out.resolve())


def normalize_video_fps(
    video_path: str,
    output_path: str,
    fps: float = 30.0,
    width: int = 1920,
    height: int = 1080,
    progress_callback: ProgressCallback | None = None,
    cancel_event: threading.Event | None = None,
    encoder: str | None = None,
    thread_limit: int | None = None,
) -> str:
    """Transcode a source video to a browser-compatible constant frame rate."""
    if not check_ffmpeg():
        raise FileNotFoundError(
            "ffmpeg not found on PATH. Install ffmpeg to enable video import normalization."
        )
    if fps <= 0:
        raise ValueError("fps must be positive")
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be positive")

    source = Path(video_path)
    if not source.is_file():
        raise FileNotFoundError(f"Video not found: {video_path}")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    configured_encoder = encoder or os.environ.get("ANNOTATE_NORMALIZE_ENCODER", "auto")
    selected_encoder = select_normalization_encoder(configured_encoder)
    threads = max(1, min(16, thread_limit or normalization_thread_limit()))
    duration_seconds = _probe_duration_seconds(str(source))
    timeout = max(1800, int((duration_seconds or 0) * 3 + 300))

    def command_for(video_encoder: str) -> list[str]:
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            "-nostdin",
            "-y",
            "-filter_threads", str(min(2, threads)),
            "-i", str(source),
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-vf", (
                f"fps={fps},"
                f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
                "setsar=1"
            ),
            "-r", str(fps),
            "-fps_mode", "cfr",
            "-c:v", video_encoder,
        ]
        if video_encoder == "h264_videotoolbox":
            bitrate = int(max(2_000_000, min(20_000_000, width * height * fps * 0.12)))
            cmd.extend([
                "-b:v", str(bitrate),
                "-maxrate", str(int(bitrate * 1.5)),
                "-bufsize", str(bitrate * 2),
                "-profile:v", "high",
            ])
        else:
            cmd.extend([
                "-preset", "veryfast",
                "-crf", "20",
                "-threads", str(threads),
            ])
        cmd.extend([
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            "-progress", "pipe:1",
            "-nostats",
            str(out),
        ])
        return cmd

    logger.info(
        "Normalizing with %s (software thread limit %s, duration %s)",
        selected_encoder,
        threads,
        f"{duration_seconds:.2f}s" if duration_seconds else "unknown",
    )
    try:
        _run_ffmpeg_with_progress(
            command_for(selected_encoder),
            label="video import normalization",
            timeout=timeout,
            duration_seconds=duration_seconds,
            progress_callback=progress_callback,
            cancel_event=cancel_event,
        )
    except EncodingCancelledError:
        raise
    except RuntimeError:
        if configured_encoder.strip().lower() != "auto" or selected_encoder == "libx264":
            raise
        logger.warning("VideoToolbox normalization failed; retrying with bounded libx264")
        out.unlink(missing_ok=True)
        _run_ffmpeg_with_progress(
            command_for("libx264"),
            label="video import normalization fallback",
            timeout=timeout,
            duration_seconds=duration_seconds,
            progress_callback=progress_callback,
            cancel_event=cancel_event,
        )

    logger.info(
        "Normalized video %s → %s at %.3f fps, %dx%d (%s bytes)",
        source,
        out,
        fps,
        width,
        height,
        out.stat().st_size if out.exists() else "missing",
    )
    return str(out.resolve())
