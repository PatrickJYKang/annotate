"""Bounded VideoToolbox import with a shared frame grid across both segments."""

from __future__ import annotations

import json
import math
import os
import subprocess
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from fractions import Fraction
from functools import lru_cache
from pathlib import Path

from .encoder import EncodingCancelledError, ProgressCallback, _run_ffmpeg_with_progress
from .video_probe import VideoProbeMetadata


@lru_cache(maxsize=1)
def _has_timestamp_filter() -> bool:
    try:
        result = subprocess.run(["ffmpeg", "-hide_banner", "-bsfs"], capture_output=True, text=True, timeout=15)
        return result.returncode == 0 and "setts" in result.stdout.split()
    except (OSError, subprocess.SubprocessError):
        return False


def supports_parallel_normalization(source: VideoProbeMetadata | None, width: int, height: int) -> bool:
    if os.environ.get("ANNOTATE_NORMALIZE_PARALLEL", "1") == "0" or not source:
        return False
    return (
        source["duration_ms"] >= 120_000
        and source["codec_name"] == "h264"
        and source["pixel_format"] == "yuv420p"
        and source["width"] == width
        and source["height"] == height
        and source.get("sample_aspect_ratio") == "1:1"
        and source.get("rotation_degrees") == 0
        and _has_timestamp_filter()
    )


class _WorkerCancellation(threading.Event):
    def __init__(self, parent: threading.Event | None):
        super().__init__()
        self.parent = parent

    def is_set(self) -> bool:
        return super().is_set() or bool(self.parent and self.parent.is_set())


def _segment_command(
    source: str, output: Path, *, fps: float, start_frame: int,
    end_frame: int | None, bitrate: int,
) -> list[str]:
    # Retain global source timestamps and decode a preroll. Independently
    # zeroing each seek would choose different frames on either side of a join.
    seek = max(0.0, start_frame / fps - 1.0)
    # The serial CFR output pads a delayed video start with its first frame.
    # Do that before trimming, so the first part still has exactly split frames.
    fps_filter = f"fps={fps}:start_time={seek}"
    filters = f"{fps_filter},trim=start_pts={start_frame}"
    if end_frame is not None:
        filters += f":end_pts={end_frame}"
    filters += ",setpts=PTS-STARTPTS,setsar=1"
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-copyts", "-start_at_zero",
        "-hwaccel", "videotoolbox", "-hwaccel_output_format", "videotoolbox_vld",
        "-ss", str(seek), "-i", source, "-map", "0:v:0", "-an",
        "-vf", filters, "-r", str(fps), "-fps_mode", "cfr",
        "-c:v", "h264_videotoolbox", "-b:v", str(bitrate),
        "-maxrate", str(int(bitrate * 1.5)), "-bufsize", str(bitrate * 2),
        "-profile:v", "high", "-bf", "0", "-pix_fmt", "videotoolbox_vld",
    ]
    if end_frame is not None:
        command += ["-frames:v", str(end_frame - start_frame)]
    return command + ["-progress", "pipe:1", "-nostats", str(output)]


def _part_metadata(path: Path) -> tuple[int, Fraction, Fraction]:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=nb_frames,r_frame_rate,time_base,has_b_frames", "-of", "json", str(path),
    ], capture_output=True, text=True, timeout=60)
    try:
        stream = json.loads(result.stdout)["streams"][0]
        count = int(stream["nb_frames"])
        rate = Fraction(stream["r_frame_rate"])
        time_base = Fraction(stream["time_base"])
        if result.returncode or count <= 0 or rate <= 0 or time_base <= 0 or stream["has_b_frames"] != 0:
            raise ValueError("Unexpected segment frame metadata")
        return count, rate, time_base
    except (ValueError, KeyError, IndexError, TypeError, ZeroDivisionError) as error:
        raise RuntimeError(f"Cannot safely join normalized segment: {path.name}") from error


def normalize_parallel(
    source_path: str, output_path: str, *, fps: float, width: int, height: int,
    source_metadata: VideoProbeMetadata, timeout: int,
    progress_callback: ProgressCallback | None, cancel_event: threading.Event | None,
) -> None:
    duration = source_metadata["duration_ms"] / 1000.0
    split = max(1, round(duration * fps / 2))
    bitrate = int(max(2_000_000, min(20_000_000, width * height * fps * 0.12)))
    cancellation = _WorkerCancellation(cancel_event)
    progress = [0.0, 0.0]
    progress_lock = threading.Lock()
    lengths = [split / fps, max(1 / fps, duration - split / fps)]

    def report(index: int, value: float) -> None:
        with progress_lock:
            progress[index] = max(progress[index], value)
            if progress_callback:
                progress_callback(0.95 * sum(p * length for p, length in zip(progress, lengths)) / sum(lengths))

    with tempfile.TemporaryDirectory(prefix="annotate_encode_", dir=Path(output_path).parent) as temporary:
        directory = Path(temporary)
        parts = [directory / "part0.mp4", directory / "part1.mp4"]

        def encode(index: int) -> None:
            _run_ffmpeg_with_progress(
                _segment_command(source_path, parts[index], fps=fps,
                                 start_frame=0 if index == 0 else split,
                                 end_frame=split if index == 0 else None, bitrate=bitrate),
                label=f"parallel video import segment {index + 1}/2", timeout=timeout,
                duration_seconds=lengths[index],
                progress_callback=lambda value: report(index, value), cancel_event=cancellation,
            )
            report(index, 1.0)

        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="annotate-encode") as pool:
            futures = [pool.submit(encode, index) for index in range(2)]
            try:
                for future in as_completed(futures):
                    future.result()
            except BaseException:
                cancellation.set()
                raise

        if cancellation.is_set():
            raise EncodingCancelledError("Video import was canceled")
        first_count, rate, time_base = _part_metadata(parts[0])
        second_count, second_rate, second_base = _part_metadata(parts[1])
        step = 1 / rate / time_base
        if (first_count != split or rate != second_rate or time_base != second_base
                or step.denominator != 1 or time_base.numerator != 1
                or not math.isclose(float(rate), fps, rel_tol=1e-6)):
            raise RuntimeError("Normalized segments do not share a safe constant frame grid")

        playlist = directory / "parts.txt"
        playlist.write_text("file 'part0.mp4'\nfile 'part1.mp4'\n", encoding="ascii")
        audio = ["-c:a", "copy"] if source_metadata["audio_codec_name"] in {None, "aac", "mp3"} else ["-c:a", "aac", "-b:a", "192k"]
        # MP4 segment durations are rounded by the concat demuxer. With B-frames
        # disabled, packet order is display order, so restore exact frame ticks.
        _run_ffmpeg_with_progress([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-f", "concat", "-safe", "0", "-i", str(playlist), "-i", source_path,
            "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "copy", *audio,
            "-bsf:v", f"setts=ts=N*{step.numerator}:duration={step.numerator}",
            "-video_track_timescale", str(time_base.denominator), "-movflags", "+faststart",
            "-progress", "pipe:1", "-nostats", output_path,
        ], label="parallel video import join", timeout=timeout, duration_seconds=duration,
            progress_callback=(lambda value: progress_callback(0.95 + 0.05 * value)) if progress_callback else None,
            cancel_event=cancellation)
        count, joined_rate, joined_base = _part_metadata(Path(output_path))
        if count != first_count + second_count or joined_rate != rate or joined_base != time_base:
            raise RuntimeError("Joined video did not preserve the segment frame grid")
