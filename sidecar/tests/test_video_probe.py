import shutil
import subprocess
import threading
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from annotate_sidecar.routes import video as video_route
from annotate_sidecar.server import create_app
from annotate_sidecar.services import normalization_jobs
from annotate_sidecar.services.video_probe import probe_video_metadata
from annotate_sidecar.video_registry import resolve_video_ref


def make_route_client() -> TestClient:
    app = FastAPI()
    app.include_router(video_route.router, prefix="/video")
    return TestClient(app)


def fake_normalize(input_path: str, output_path: str, **_kwargs) -> str:
    shutil.copyfile(input_path, output_path)
    return output_path


def fake_metadata(_path: str):
    return {
        "fps": 30.0,
        "fps_numerator": 30,
        "fps_denominator": 1,
        "frame_count": 123,
        "frame_count_source": "container",
        "width": 1920,
        "height": 1080,
        "duration_ms": 4100.0,
        "codec_name": "h264",
        "pixel_format": "yuv420p",
        "audio_codec_name": "aac",
        "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
        "constant_frame_rate": True,
    }


def test_video_registration_streams_to_registry_and_cleans_up():
    client = make_route_client()
    payload = b"a" * (2 * 1024 * 1024 + 17)

    response = client.post(
        "/video/register",
        files={"file": ("long-match.mp4", payload, "video/mp4")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["sizeBytes"] == len(payload)
    registered_path = resolve_video_ref(body["videoRef"])
    assert registered_path is not None
    assert Path(registered_path).read_bytes() == payload
    assert client.delete(f'/video/{body["videoRef"]}').status_code == 200
    assert resolve_video_ref(body["videoRef"]) is None


def test_normalize_exposes_authoritative_frame_headers(monkeypatch):
    monkeypatch.setattr(video_route, "normalize_video_fps", fake_normalize)
    monkeypatch.setattr(video_route, "probe_video_metadata", fake_metadata)

    response = make_route_client().post(
        "/video/normalize",
        files={"file": ("source.mp4", b"video", "video/mp4")},
        data={"fps": "30", "width": "1920", "height": "1080"},
    )

    assert response.status_code == 200
    assert response.headers["X-Annotate-Frame-Count"] == "123"
    assert response.headers["X-Annotate-Fps"] == "30"


def test_normalize_job_reports_real_progress_and_serves_result(monkeypatch):
    started = threading.Event()
    release = threading.Event()

    def fake_job_normalize(input_path: str, output_path: str, **kwargs) -> str:
        kwargs["progress_callback"](0.42)
        started.set()
        assert release.wait(timeout=2)
        shutil.copyfile(input_path, output_path)
        kwargs["progress_callback"](1.0)
        return output_path

    normalization_jobs.cleanup_normalization_jobs()
    monkeypatch.setattr(normalization_jobs, "normalize_video_fps", fake_job_normalize)
    monkeypatch.setattr(normalization_jobs, "probe_video_metadata", fake_metadata)
    client = make_route_client()

    try:
        started_response = client.post(
            "/video/normalize/start",
            files={"file": ("source.mp4", b"video", "video/mp4")},
            data={"fps": "30", "width": "1920", "height": "1080"},
        )
        assert started_response.status_code == 200
        job_id = started_response.json()["jobId"]
        assert started.wait(timeout=2)

        active = client.get(f"/video/normalize/{job_id}")
        assert active.status_code == 200
        assert active.json()["status"] == "normalizing"
        assert active.json()["progress"] == pytest.approx(0.42)

        release.set()
        complete = None
        for _ in range(100):
            complete = client.get(f"/video/normalize/{job_id}")
            if complete.json()["status"] == "complete":
                break
            time.sleep(0.01)
        assert complete is not None
        assert complete.json()["status"] == "complete"
        assert complete.json()["metadata"]["frameCount"] == 123

        artifact = client.get(f"/video/normalize/{job_id}/file")
        assert artifact.status_code == 200
        assert artifact.content == b"video"
        assert artifact.headers["X-Annotate-Frame-Count"] == "123"
        assert client.get(f"/video/normalize/{job_id}").status_code == 404
    finally:
        release.set()
        normalization_jobs.cleanup_normalization_jobs()


def test_normalization_jobs_are_serialized(monkeypatch, tmp_path):
    first_started = threading.Event()
    release_first = threading.Event()
    calls: list[str] = []

    def fake_job_normalize(input_path: str, output_path: str, **kwargs) -> str:
        calls.append(input_path)
        if len(calls) == 1:
            first_started.set()
            assert release_first.wait(timeout=2)
        shutil.copyfile(input_path, output_path)
        kwargs["progress_callback"](1.0)
        return output_path

    monkeypatch.setattr(normalization_jobs, "normalize_video_fps", fake_job_normalize)
    monkeypatch.setattr(normalization_jobs, "probe_video_metadata", fake_metadata)
    normalization_jobs.cleanup_normalization_jobs()
    first_dir = tmp_path / "first"
    second_dir = tmp_path / "second"
    first_dir.mkdir()
    second_dir.mkdir()
    first_input = first_dir / "source.mp4"
    second_input = second_dir / "source.mp4"
    first_input.write_bytes(b"first")
    second_input.write_bytes(b"second")

    try:
        first = normalization_jobs.start_normalization_job(
            first_dir,
            first_input,
            fps=30,
            width=1920,
            height=1080,
        )
        assert first_started.wait(timeout=2)
        second = normalization_jobs.start_normalization_job(
            second_dir,
            second_input,
            fps=30,
            width=1920,
            height=1080,
        )
        time.sleep(0.05)
        assert normalization_jobs.get_normalization_job(second["jobId"])["status"] == "queued"

        release_first.set()
        for job_id in [first["jobId"], second["jobId"]]:
            for _ in range(100):
                state = normalization_jobs.get_normalization_job(job_id)
                if state["status"] == "complete":
                    break
                time.sleep(0.01)
            assert state["status"] == "complete"
        assert calls == [str(first_input), str(second_input)]
    finally:
        release_first.set()
        normalization_jobs.cleanup_normalization_jobs()


def test_smart_import_preserves_compatible_mp4_without_encoding(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    monkeypatch.setattr(normalization_jobs, "probe_video_metadata", fake_metadata)
    monkeypatch.setattr(
        normalization_jobs,
        "normalize_video_fps",
        lambda *_args, **_kwargs: pytest.fail("compatible MP4 should not be transcoded"),
    )
    monkeypatch.setattr(
        normalization_jobs,
        "remux_video_for_browser",
        lambda *_args, **_kwargs: pytest.fail("compatible MP4 should not be remuxed"),
    )
    normalization_jobs.cleanup_normalization_jobs()
    job = normalization_jobs.start_normalization_job(tmp_path, source)
    try:
        state = None
        for _ in range(100):
            state = normalization_jobs.get_normalization_job(job["jobId"])
            if state["status"] == "complete":
                break
            time.sleep(0.01)
        assert state is not None
        assert state["status"] == "complete"
        assert state["metadata"]["importStrategy"] == "preserve"
        assert state["metadata"]["frameCountSource"] == "probe"
        result_path, _metadata = normalization_jobs.get_normalization_result(job["jobId"])
        assert result_path == source
    finally:
        normalization_jobs.cleanup_normalization_jobs()


def test_probe_route_returns_frame_native_metadata(monkeypatch):
    monkeypatch.setattr(video_route, "probe_video_metadata", fake_metadata)

    response = make_route_client().post(
        "/video/probe",
        files={"file": ("source.mp4", b"video", "video/mp4")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "fps": 30.0,
        "frameCount": 123,
        "width": 1920,
        "height": 1080,
        "durationMs": 4100.0,
    }


def test_cors_exposes_frame_metadata_headers(monkeypatch):
    monkeypatch.setattr(video_route, "normalize_video_fps", fake_normalize)
    monkeypatch.setattr(video_route, "probe_video_metadata", fake_metadata)
    response = TestClient(create_app()).post(
        "/video/normalize",
        headers={"Origin": "http://localhost:3000"},
        files={"file": ("source.mp4", b"video", "video/mp4")},
        data={"fps": "30", "width": "1920", "height": "1080"},
    )

    exposed = response.headers["access-control-expose-headers"].lower()
    assert "x-annotate-frame-count" in exposed
    assert "x-annotate-fps" in exposed
    assert "x-annotate-import-strategy" in exposed


@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="ffmpeg/ffprobe unavailable")
def test_probe_counts_frames_from_a_real_cfr_video(tmp_path):
    video = tmp_path / "seven-frames.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f", "lavfi",
            "-i", "color=c=black:s=160x90:r=25",
            "-frames:v", "7",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(video),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    metadata = probe_video_metadata(str(video))

    assert metadata["frame_count"] == 7
    assert metadata["fps"] == pytest.approx(25.0)
    assert metadata["width"] == 160
    assert metadata["height"] == 90


@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="ffmpeg/ffprobe unavailable")
@pytest.mark.parametrize(
    ("extension", "expected_strategy"),
    [("mp4", "preserve"), ("mov", "remux")],
)
def test_smart_import_avoids_video_transcode_for_compatible_cfr_sources(
    tmp_path,
    extension,
    expected_strategy,
):
    source = tmp_path / f"compatible.{extension}"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f", "lavfi",
            "-i", "color=c=black:s=160x90:r=25",
            "-frames:v", "7",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(source),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    normalization_jobs.cleanup_normalization_jobs()
    client = make_route_client()
    try:
        response = client.post(
            "/video/normalize/start",
            files={"file": (source.name, source.read_bytes(), f"video/{extension}")},
        )
        assert response.status_code == 200
        job_id = response.json()["jobId"]
        state = None
        for _ in range(200):
            state = client.get(f"/video/normalize/{job_id}").json()
            if state["status"] == "complete":
                break
            time.sleep(0.01)
        assert state is not None
        assert state["status"] == "complete"
        assert state["metadata"]["importStrategy"] == expected_strategy
        assert state["metadata"]["frameCount"] == 7
        assert state["metadata"]["width"] == 160
        assert state["metadata"]["height"] == 90
        artifact = client.get(f"/video/normalize/{job_id}/file")
        assert artifact.status_code == 200
        assert artifact.headers["X-Annotate-Import-Strategy"] == expected_strategy
        assert len(artifact.content) > 0
    finally:
        normalization_jobs.cleanup_normalization_jobs()
