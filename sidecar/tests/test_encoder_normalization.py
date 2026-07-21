from pathlib import Path

from annotate_sidecar.services import encoder


def test_auto_normalization_prefers_videotoolbox_on_macos(monkeypatch):
    monkeypatch.setattr(encoder.sys, "platform", "darwin")
    monkeypatch.setattr(
        encoder,
        "_ffmpeg_encoder_available",
        lambda name: name == "h264_videotoolbox",
    )

    assert encoder.select_normalization_encoder("auto") == "h264_videotoolbox"


def test_software_normalization_caps_threads_and_reports_progress(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    output = tmp_path / "normalized.mp4"
    source.write_bytes(b"source")
    captured: dict[str, object] = {}
    progress: list[float] = []

    monkeypatch.setattr(encoder, "check_ffmpeg", lambda: True)
    monkeypatch.setattr(encoder, "select_normalization_encoder", lambda _configured: "libx264")
    monkeypatch.setattr(encoder, "_probe_duration_seconds", lambda _path: 10.0)

    def fake_run(cmd, **kwargs):
        captured["cmd"] = list(cmd)
        kwargs["progress_callback"](0.5)
        Path(cmd[-1]).write_bytes(b"normalized")

    monkeypatch.setattr(encoder, "_run_ffmpeg_with_progress", fake_run)

    result = encoder.normalize_video_fps(
        str(source),
        str(output),
        fps=30,
        width=1920,
        height=1080,
        progress_callback=progress.append,
        encoder="libx264",
        thread_limit=3,
    )

    command = captured["cmd"]
    assert result == str(output.resolve())
    assert command[command.index("-threads") + 1] == "3"
    assert command[command.index("-filter_threads") + 1] == "2"
    assert command[command.index("-preset") + 1] == "veryfast"
    assert "-progress" in command
    assert progress == [0.5]
