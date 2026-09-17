import json
import shutil
import subprocess
import sys
import threading
from fractions import Fraction
from pathlib import Path

import pytest

from annotate_sidecar.services import encoder, parallel_normalization as parallel
from annotate_sidecar.services.video_probe import probe_video_metadata


def metadata(**overrides):
    return {
        "fps": 30, "duration_ms": 120_000, "codec_name": "h264",
        "pixel_format": "yuv420p", "width": 1024, "height": 576,
        "sample_aspect_ratio": "1:1", "rotation_degrees": 0,
        "audio_codec_name": "aac", **overrides,
    }


def test_fast_path_is_guarded_by_duration_geometry_and_codec(monkeypatch):
    monkeypatch.setattr(parallel, "_has_timestamp_filter", lambda: True)
    assert parallel.supports_parallel_normalization(metadata(), 1024, 576)
    for changes in [
        {"duration_ms": 119_999}, {"width": 1920}, {"height": 1080},
        {"codec_name": "hevc"}, {"pixel_format": "yuv420p10le"},
        {"sample_aspect_ratio": "4:3"}, {"rotation_degrees": 90},
    ]:
        assert not parallel.supports_parallel_normalization(metadata(**changes), 1024, 576)
    assert not parallel.supports_parallel_normalization(None, 1024, 576)
    monkeypatch.setenv("ANNOTATE_NORMALIZE_PARALLEL", "0")
    assert not parallel.supports_parallel_normalization(metadata(), 1024, 576)


def test_join_restores_exact_packet_ticks_and_copies_compatible_audio(monkeypatch, tmp_path):
    commands = []
    rendezvous = threading.Barrier(2)
    progress = []

    def run(command, **kwargs):
        commands.append(command)
        if "-f" not in command:
            rendezvous.wait(timeout=2)
        kwargs["progress_callback"](0.5)
        Path(command[-1]).write_bytes(b"video")
        kwargs["progress_callback"](1.0)

    monkeypatch.setattr(parallel, "_run_ffmpeg_with_progress", run)
    monkeypatch.setattr(parallel, "_part_metadata", lambda path: (
        300 if path.name == "output.mp4" else 150, Fraction(25), Fraction(1, 12800),
    ))
    parallel.normalize_parallel("source.mp4", str(tmp_path / "output.mp4"), fps=25,
                                width=1024, height=576, source_metadata=metadata(duration_ms=12_000),
                                timeout=60, progress_callback=progress.append, cancel_event=None)
    assert len(commands) == 3
    join = commands[-1]
    assert join[join.index("-c:a") + 1] == "copy"
    assert join[join.index("-bsf:v") + 1] == "setts=ts=N*512:duration=512"
    assert join[join.index("-video_track_timescale") + 1] == "12800"
    assert progress == sorted(progress)
    assert progress[-1] == 1
    assert list(tmp_path.iterdir()) == [tmp_path / "output.mp4"]


def test_worker_failure_cancels_sibling_and_cleans_segments(monkeypatch, tmp_path):
    rendezvous = threading.Barrier(2)

    def run(command, **kwargs):
        rendezvous.wait(timeout=2)
        if command[-1].endswith("part0.mp4"):
            raise RuntimeError("hardware failure")
        assert kwargs["cancel_event"].wait(timeout=2)
        raise encoder.EncodingCancelledError("sibling stopped")

    monkeypatch.setattr(parallel, "_run_ffmpeg_with_progress", run)
    with pytest.raises(RuntimeError, match="hardware failure"):
        parallel.normalize_parallel("source.mp4", str(tmp_path / "output.mp4"), fps=30,
                                    width=1024, height=576, source_metadata=metadata(),
                                    timeout=60, progress_callback=None, cancel_event=None)
    assert list(tmp_path.iterdir()) == []


def test_user_cancellation_stops_both_workers_without_joining(monkeypatch, tmp_path):
    cancellation = threading.Event()
    cancellation.set()

    def run(command, **kwargs):
        assert "concat" not in command
        assert kwargs["cancel_event"].is_set()
        raise encoder.EncodingCancelledError("canceled")

    monkeypatch.setattr(parallel, "_run_ffmpeg_with_progress", run)
    with pytest.raises(encoder.EncodingCancelledError):
        parallel.normalize_parallel("source.mp4", str(tmp_path / "output.mp4"), fps=30,
                                    width=1024, height=576, source_metadata=metadata(),
                                    timeout=60, progress_callback=None, cancel_event=cancellation)
    assert list(tmp_path.iterdir()) == []


def test_fast_path_failure_retries_original_encoder_not_partial_output(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    output = tmp_path / "output.mp4"
    monkeypatch.setattr(encoder, "check_ffmpeg", lambda: True)
    monkeypatch.setattr(encoder, "select_normalization_encoder", lambda _: "h264_videotoolbox")
    monkeypatch.setattr(encoder, "_probe_duration_seconds", lambda _: 120)
    monkeypatch.setattr(parallel, "supports_parallel_normalization", lambda *_: True)

    def fail(*_args, **_kwargs):
        output.write_bytes(b"partial")
        raise RuntimeError("cannot join")

    def serial(command, **_kwargs):
        assert not output.exists()
        assert command[command.index("-c:v") + 1] == "h264_videotoolbox"
        output.write_bytes(b"complete")

    monkeypatch.setattr(parallel, "normalize_parallel", fail)
    monkeypatch.setattr(encoder, "_run_ffmpeg_with_progress", serial)
    encoder.normalize_video_fps(str(source), str(output), source_metadata=metadata())
    assert output.read_bytes() == b"complete"


@pytest.fixture
def vfr_video(tmp_path):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg and ffprobe are needed for real media regression coverage")
    path = tmp_path / "vfr.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=4",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
        "-vf", "select=not(eq(mod(n\\,37)\\,0))", "-fps_mode", "vfr", "-c:v", "libx264",
        "-threads", "1", "-g", "30", "-bf", "2", "-c:a", "aac", "-output_ts_offset", "0.034", str(path),
    ], check=True, timeout=30)
    return path


def frame_hashes(command, destination):
    subprocess.run(command + ["-f", "framemd5", str(destination)], check=True, capture_output=True, timeout=30)
    return [line.split(",")[-1].strip() for line in destination.read_text().splitlines() if not line.startswith("#")]


@pytest.mark.parametrize("split", [1, 47, 90])
def test_fractional_frame_grid_selects_identical_frames_across_seeks(vfr_video, tmp_path, split):
    fps = 30000 / 1001
    expected = frame_hashes([
        "ffmpeg", "-v", "error", "-y", "-i", str(vfr_video), "-map", "0:v:0", "-an",
        "-vf", f"fps={fps},setsar=1", "-r", str(fps), "-fps_mode", "cfr",
    ], tmp_path / "reference.md5")
    actual = []
    for index, (start, end) in enumerate([(0, split), (split, None)]):
        command = parallel._segment_command(str(vfr_video), tmp_path / "unused.mp4", fps=fps,
                                            start_frame=start, end_frame=end, bitrate=2_000_000)
        command = command[:command.index("-c:v")]
        for option in ["-hwaccel", "-hwaccel_output_format"]:
            position = command.index(option)
            del command[position:position + 2]
        actual.extend(frame_hashes(command, tmp_path / f"part{index}.md5"))
    assert actual == expected


@pytest.mark.skipif(sys.platform != "darwin", reason="VideoToolbox is macOS-only")
def test_real_hardware_join_preserves_frame_grid_and_audio(vfr_video, tmp_path):
    if not encoder._ffmpeg_encoder_available("h264_videotoolbox"):
        pytest.skip("ffmpeg was built without VideoToolbox")
    source = probe_video_metadata(str(vfr_video))
    output = tmp_path / "joined.mp4"
    progress = []
    parallel.normalize_parallel(str(vfr_video), str(output), fps=30000 / 1001,
                                width=160, height=90, source_metadata=source,
                                timeout=30, progress_callback=progress.append, cancel_event=None)
    result = probe_video_metadata(str(output))
    assert result["constant_frame_rate"]
    assert result["fps"] == pytest.approx(30000 / 1001)
    packets = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_packets", "-show_entries",
        "packet=pts,dts,duration", "-of", "json", str(output),
    ]))["packets"]
    step = packets[0]["duration"]
    assert all(p["pts"] == p["dts"] == index * step for index, p in enumerate(packets))
    assert len(packets) == result["frame_count"]
    assert progress == sorted(progress)
    assert progress[-1] == 1

    def audio_packets(path):
        return json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_packets", "-show_data_hash", "sha256",
            "-show_entries", "packet=data_hash,pts_time", "-of", "json", str(path),
        ]))["packets"]

    before, after = audio_packets(vfr_video), audio_packets(output)
    assert [p["data_hash"] for p in before] == [p["data_hash"] for p in after]
    assert float(after[0]["pts_time"]) == pytest.approx(0, abs=1 / 48000)
