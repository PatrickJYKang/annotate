import pytest
from fastapi.testclient import TestClient

from annotate_sidecar.server import create_app

TOKEN = "a" * 64
ORIGIN = "http://127.0.0.1:9123"


def client(monkeypatch, managed=True):
    if managed:
        monkeypatch.setenv("ANNOTATE_AUTH_TOKEN", TOKEN)
        monkeypatch.setenv("ANNOTATE_ALLOWED_ORIGINS", ORIGIN)
    else:
        monkeypatch.delenv("ANNOTATE_AUTH_TOKEN", raising=False)
        monkeypatch.delenv("ANNOTATE_ALLOWED_ORIGINS", raising=False)
    app = create_app()

    @app.get("/session-test")
    def session_test():
        return {"ok": True}

    return TestClient(app)


def test_managed_sidecar_requires_auth_for_http_routes(monkeypatch):
    app = client(monkeypatch)
    assert app.get("/session-test").status_code == 401
    assert app.get("/session-test", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert app.get("/session-test", headers={"Authorization": f"Bearer {TOKEN}"}).json() == {"ok": True}


def test_managed_sidecar_limits_origins_and_supports_cors_preflight(monkeypatch):
    app = client(monkeypatch)
    assert app.get("/session-test", headers={"Authorization": f"Bearer {TOKEN}", "Origin": "https://example.com"}).status_code == 403
    response = app.options("/session-test", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Authorization"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert app.options("/session-test", headers={"Origin": "http://localhost:9999", "Access-Control-Request-Method": "GET"}).status_code == 400


def test_browser_mode_keeps_existing_no_token_workflow(monkeypatch):
    assert client(monkeypatch, managed=False).get("/session-test").json() == {"ok": True}


def test_managed_mode_refuses_weak_or_unscoped_configuration(monkeypatch):
    monkeypatch.setenv("ANNOTATE_AUTH_TOKEN", "weak")
    monkeypatch.setenv("ANNOTATE_ALLOWED_ORIGINS", ORIGIN)
    with pytest.raises(ValueError):
        create_app()
    monkeypatch.setenv("ANNOTATE_AUTH_TOKEN", TOKEN)
    monkeypatch.delenv("ANNOTATE_ALLOWED_ORIGINS")
    with pytest.raises(ValueError):
        create_app()
