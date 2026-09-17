"""Copy near-CFR H.264 onto a regular clock without decoding its pictures."""

from __future__ import annotations

import json
import logging
import math
import os
import subprocess
import threading
import time
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from .encoder import EncodingCancelledError, ProgressCallback, _run_ffmpeg_with_progress
from .video_probe import VideoProbeMetadata

logger = logging.getLogger("annotate_sidecar.timestamp_normalization")
MAX_SHIFT_SECONDS = 0.2
MAX_PACKETS = 1_000_000


@dataclass
class TimingPlan:
    rate: Fraction
    nominal: Fraction
    delay: int
    display_order: list[int]
    corrections: list[tuple[int, int]]
    max_shift: float


def _scan(path: Path, cancel_event: threading.Event | None) -> dict:
    command = [
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_packets", "-show_streams",
        "-show_entries", "stream=time_base,avg_frame_rate,r_frame_rate:format=start_time:packet=pts,dts,duration,flags",
        "-of", "json", str(path),
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    deadline = time.monotonic() + 30
    try:
        while True:
            if cancel_event and cancel_event.is_set():
                raise EncodingCancelledError("Video import was canceled")
            if time.monotonic() >= deadline:
                raise RuntimeError("Packet timing scan timed out")
            try:
                stdout, stderr = process.communicate(timeout=0.2)
                break
            except subprocess.TimeoutExpired:
                continue
        if process.returncode:
            raise RuntimeError(stderr.decode(errors="replace"))
        return json.loads(stdout)
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


def _plan(data: dict, expected_count: int) -> TimingPlan | None:
    packets = data["packets"]
    stream = data["streams"][0]
    base = Fraction(stream["time_base"])
    nominal = Fraction(stream["r_frame_rate"])
    rate = Fraction(stream["avg_frame_rate"]).limit_denominator(100_000)
    if (len(packets) != expected_count or not 2 <= len(packets) <= MAX_PACKETS
            or not 1 <= rate <= 240 or not 1 <= nominal <= 240 or base <= 0
            or rate.numerator > 10_000_000 or abs(float(rate / nominal) - 1) > 0.01):
        return None
    pts = [int(p["pts"]) for p in packets]
    dts = [int(p["dts"]) for p in packets]
    if (any("C" in p.get("flags", "") for p in packets)
            or any(b <= a for a, b in zip(dts, dts[1:]))):
        return None
    order = sorted(range(len(pts)), key=pts.__getitem__)
    # A muxer may retain a final reference picture just past its edit-list end.
    # At most two such trailing pictures are harmless; never expose seek preroll
    # or discarded pictures inside the passage of play.
    trailing = set(order[-2:])
    if any("D" in p.get("flags", "") and index not in trailing for index, p in enumerate(packets)):
        return None
    times = [pts[index] * float(base) for index in order]
    origin = float(data["format"]["start_time"])
    if abs(times[0] - origin) > 0.025:
        return None
    gaps = [b - a for a, b in zip(times, times[1:])]
    if min(gaps) < 0.5 / float(nominal) or max(gaps) > 2.5 / float(nominal):
        return None
    max_shift = max(abs(rank / float(rate) - (timestamp - origin)) for rank, timestamp in enumerate(times))
    if max_shift > MAX_SHIFT_SECONDS:
        return None
    display = [0] * len(pts)
    for rank, index in enumerate(order):
        display[index] = rank
    delay = math.floor((pts[0] - dts[0]) * float(base * nominal) + 0.5)
    if not 0 <= delay <= 16 or any(rank < index - delay or rank > index + 16 for index, rank in enumerate(display)):
        return None
    corrections = []
    for index, rank in enumerate(display):
        predicted = index + math.floor((pts[index] - dts[index]) * float(base * nominal) + 0.5) - delay
        if predicted != rank:
            corrections.append((index, predicted - rank))
    if len(corrections) > 512:
        return None
    return TimingPlan(rate, nominal, delay, display, corrections, max_shift)


def _sum_expression(terms: list[str]) -> str:
    # A flat sum hits FFmpeg's expression recursion limit on longer footage.
    if len(terms) < 2:
        return terms[0] if terms else "0"
    middle = len(terms) // 2
    return f"({_sum_expression(terms[:middle])}+{_sum_expression(terms[middle:])})"


def _filter(plan: TimingPlan) -> str:
    corrections = _sum_expression([f"eq(N\\,{index})*({delta})" for index, delta in plan.corrections])
    step = plan.rate.denominator
    # Rescale first, preserving both PTS and DTS (setts defaults to DTS for both).
    # Then rebuild the regular clock while retaining decoded/display reordering.
    return (
        f"setts=pts=PTS:dts=DTS:duration=DURATION:time_base=1/{plan.rate.numerator},"
        f"setts=pts=(N+round((PTS-DTS)*TB*{float(plan.nominal)})-{plan.delay}-({corrections}))*{step}:"
        f"dts=(N-{plan.delay})*{step}:duration={step}"
    )


def _verify(data: dict, plan: TimingPlan) -> None:
    packets = data["packets"]
    stream = data["streams"][0]
    if (len(packets) != len(plan.display_order) or Fraction(stream["time_base"]) != Fraction(1, plan.rate.numerator)
            or Fraction(stream["avg_frame_rate"]) != plan.rate or Fraction(stream["r_frame_rate"]) != plan.rate):
        raise RuntimeError("Retimed video metadata did not preserve the planned clock")
    step = plan.rate.denominator
    for index, packet in enumerate(packets):
        if (packet["pts"] != plan.display_order[index] * step or packet["dts"] != (index - plan.delay) * step
                or packet["duration"] != step):
            raise RuntimeError("Retimed video did not preserve frame order on the regular clock")


def try_retime_video(
    source: Path, output: Path, metadata: VideoProbeMetadata, *,
    progress_callback: ProgressCallback | None = None, cancel_event: threading.Event | None = None,
) -> bool:
    if (os.environ.get("ANNOTATE_NORMALIZE_RETIME", "1") == "0"
            or metadata["constant_frame_rate"] or metadata["codec_name"] != "h264"
            or metadata["pixel_format"] != "yuv420p" or "mp4" not in metadata["format_name"].split(",")
            or metadata["audio_codec_name"] not in {None, "aac", "mp3"}
            or metadata.get("sample_aspect_ratio") != "1:1" or metadata.get("rotation_degrees") != 0
            or not 2 <= metadata["frame_count"] <= MAX_PACKETS):
        return False
    try:
        plan = _plan(_scan(source, cancel_event), metadata["frame_count"])
        if plan is None:
            logger.info("Source timing is too irregular for timestamp-only import; using encoding")
            return False
        logger.info("Timestamp-only import: %s frames, maximum timing adjustment %.1f ms",
                    len(plan.display_order), plan.max_shift * 1000)
        _run_ffmpeg_with_progress([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(source),
            "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-bsf:v", _filter(plan),
            "-video_track_timescale", str(plan.rate.numerator), "-movflags", "+faststart",
            "-progress", "pipe:1", "-nostats", str(output),
        ], label="timestamp-only video import", timeout=300,
            duration_seconds=metadata["duration_ms"] / 1000,
            progress_callback=progress_callback, cancel_event=cancel_event)
        _verify(_scan(output, cancel_event), plan)
        return True
    except EncodingCancelledError:
        output.unlink(missing_ok=True)
        raise
    except (RuntimeError, OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, IndexError, ZeroDivisionError) as error:
        logger.warning("Timestamp-only import unavailable; using encoding: %s", error)
        output.unlink(missing_ok=True)
        return False
