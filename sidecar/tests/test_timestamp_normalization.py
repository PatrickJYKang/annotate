import json
import shutil
import subprocess
import threading

import pytest

from annotate_sidecar.services import timestamp_normalization as timing
from annotate_sidecar.services.encoder import EncodingCancelledError
from annotate_sidecar.services.video_probe import probe_video_metadata


def packet_data():
    return {
        "streams": [{"time_base": "1/30000", "r_frame_rate": "30/1", "avg_frame_rate": "30/1"}],
        "format": {"start_time": "0"},
        "packets": [{"pts": index * 1000, "dts": index * 1000, "duration": 1000, "flags": "__"}
                    for index in range(120)],
    }


@pytest.mark.parametrize("problem", ["duplicate", "gap", "drift", "order", "preroll", "late-start", "count"])
def test_unsafe_timestamps_are_rejected(problem):
    data = packet_data()
    count = 120
    if problem == "duplicate":
        data["packets"][20]["pts"] = data["packets"][19]["pts"]
    elif problem == "gap":
        for packet in data["packets"][20:]:
            packet["pts"] += 10000
    elif problem == "drift":
        for index, packet in enumerate(data["packets"]):
            packet["pts"] += index * 100
    elif problem == "order":
        data["packets"][20]["dts"] = 1
    elif problem == "preroll":
        data["packets"][0]["flags"] = "_D"
    elif problem == "late-start":
        data["format"]["start_time"] = "-1"
    else:
        count = 119
    assert timing._plan(data, count) is None


def test_packet_reordering_and_sparse_timing_corrections():
    data = packet_data()
    order = [0, 3, 1, 2, *range(4, 120)]
    for index, rank in enumerate(order):
        data["packets"][index]["pts"] = rank * 1000 + (1000 if rank >= 3 else 0)
        data["packets"][index]["dts"] = (index - 2) * 1000
    plan = timing._plan(data, 120)
    assert plan is not None
    assert plan.display_order == order
    assert plan.corrections
    assert "setts=pts=PTS:dts=DTS" in timing._filter(plan)


def test_allows_only_two_terminal_reference_pictures_outside_an_edit_list():
    data = packet_data()
    for packet in data['packets'][-2:]:
        packet['flags'] = '_D'
    assert timing._plan(data, 120) is not None
    data['packets'][-3]['flags'] = '_D'
    assert timing._plan(data, 120) is None


@pytest.fixture
def near_cfr(tmp_path):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("FFmpeg is required for real media tests")
    source = tmp_path / "source.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=4",
        "-f", "lavfi", "-i", "sine=sample_rate=48000:duration=4",
        "-vf", "select=not(eq(n\\,60))", "-fps_mode", "vfr", "-c:v", "libx264", "-threads", "1",
        "-bf", "2", "-c:a", "aac", "-output_ts_offset", "0.034", str(source),
    ], check=True, capture_output=True, timeout=30)
    return source


def test_real_retiming_preserves_pictures_audio_and_cfr_clock(near_cfr, tmp_path):
    source = probe_video_metadata(str(near_cfr))
    assert not source["constant_frame_rate"]
    output = tmp_path / "retimed.mp4"
    progress = []
    assert timing.try_retime_video(near_cfr, output, source, progress_callback=progress.append)
    result = probe_video_metadata(str(output))
    assert result["frame_count"] == source["frame_count"]
    assert result["constant_frame_rate"]
    assert result["fps"] == pytest.approx(source["fps"])
    plan = timing._plan(timing._scan(near_cfr, None), source["frame_count"])
    timing._verify(timing._scan(output, None), plan)
    assert progress[-1] == 1

    def packet_hashes(path, stream):
        return json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-select_streams", stream, "-show_packets", "-show_data_hash", "sha256",
            "-show_entries", "packet=data_hash", "-of", "json", str(path),
        ]))["packets"]

    for stream in ["v:0", "a:0"]:
        assert packet_hashes(near_cfr, stream) == packet_hashes(output, stream)

    def decoded_frames(path):
        result = subprocess.check_output([
            "ffmpeg", "-v", "error", "-threads", "1", "-i", str(path), "-map", "0:v:0", "-fps_mode", "passthrough",
            "-f", "framemd5", "-",
        ], timeout=30).decode()
        return [line.split(",")[-1] for line in result.splitlines() if not line.startswith("#")]

    assert decoded_frames(near_cfr) == decoded_frames(output)


def test_validation_failure_removes_partial_file_and_allows_encoding(near_cfr, tmp_path, monkeypatch):
    source = probe_video_metadata(str(near_cfr))
    output = tmp_path / "invalid.mp4"
    monkeypatch.setattr(timing, "_verify", lambda *_: (_ for _ in ()).throw(RuntimeError("invalid order")))
    assert not timing.try_retime_video(near_cfr, output, source)
    assert not output.exists()


def test_cancel_and_explicit_disable(near_cfr, tmp_path, monkeypatch):
    source = probe_video_metadata(str(near_cfr))
    output = tmp_path / "canceled.mp4"
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(EncodingCancelledError):
        timing.try_retime_video(near_cfr, output, source, cancel_event=cancel)
    assert not output.exists()
    monkeypatch.setenv("ANNOTATE_NORMALIZE_RETIME", "0")
    assert not timing.try_retime_video(near_cfr, output, source)
