import time
from pathlib import Path

from fastapi.testclient import TestClient

from annotate_sidecar.server import create_app
from annotate_sidecar.video_registry import register_video_path, resolve_video_ref, unregister_video_ref
from annotate_sidecar.services.normalization_jobs import cleanup_normalization_job, get_normalization_job


def test_external_video_unregister_preserves_source(tmp_path):
    source = tmp_path / 'source.mp4'
    source.write_bytes(b'source')
    ref = register_video_path(source, owned=False)
    assert resolve_video_ref(ref) == str(source)
    assert unregister_video_ref(ref)
    assert source.read_bytes() == b'source'
    assert resolve_video_ref(ref) is None
    owned = tmp_path / 'uploaded.mp4'
    owned.write_bytes(b'temporary')
    ref = register_video_path(owned)
    unregister_video_ref(ref)
    assert not owned.exists()


def test_native_routes_are_unavailable_in_browser_mode(monkeypatch, tmp_path):
    monkeypatch.delenv('ANNOTATE_AUTH_TOKEN', raising=False)
    client = TestClient(create_app())
    assert client.post('/native/register', json={'path': str(tmp_path)}).status_code == 404


def test_native_import_uses_real_probe_and_cleanup_preserves_original(monkeypatch):
    monkeypatch.setenv('ANNOTATE_AUTH_TOKEN', 'a' * 64)
    monkeypatch.setenv('ANNOTATE_ALLOWED_ORIGINS', 'http://127.0.0.1:9001')
    client = TestClient(create_app())
    headers = {'Authorization': 'Bearer ' + 'a' * 64}
    source = Path(__file__).parents[2] / 'webapp/e2e/fixtures/clip-editor-project/media/retrieval-sample.mp4'
    before = source.read_bytes()
    assert client.post('/native/register', json={'path': str(source)}).status_code == 401
    ref = client.post('/native/register', headers=headers, json={'path': str(source)}).json()['videoRef']
    job = client.post('/native/import', headers=headers, json={'videoRef': ref}).json()['jobId']
    try:
        deadline = time.monotonic() + 20
        while get_normalization_job(job)['status'] not in {'complete', 'failed'} and time.monotonic() < deadline:
            time.sleep(0.05)
        result = client.get(f'/native/import/{job}/result', headers=headers)
        assert result.status_code == 200, result.text
        assert result.json()['metadata']['frameCount'] == 50
        assert result.json()['metadata']['importStrategy'] == 'preserve'
    finally:
        cleanup_normalization_job(job)
        unregister_video_ref(ref)
    assert source.read_bytes() == before
