"""The HTTP surface fails closed without ever loading a plugin."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("VST3_RENDER_TOKEN", "test-secret")
    monkeypatch.setenv("VST3_RENDER_ASSET_MANIFEST", str(tmp_path / "missing-manifest.json"))
    monkeypatch.setenv("VST3_RENDER_STATE_DIR", str(tmp_path / "state"))
    import app as app_module

    importlib.reload(app_module)
    from fastapi.testclient import TestClient

    return TestClient(app_module.app)


def test_health_requires_a_bearer_token(client):
    assert client.get("/health").status_code == 401
    assert client.get("/health", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_health_reports_unhealthy_with_reasons_when_nothing_is_configured(client):
    response = client.get("/health", headers={"Authorization": "Bearer test-secret"})
    assert response.status_code == 200
    body = response.json()
    assert body["healthy"] is False
    assert body["contractVersion"] == "1.0" and body["provider"] == "VST3"
    assert any("asset manifest" in p for p in body["problems"])
    assert "asset" not in body and "smokeEvidence" not in body


def test_render_refuses_when_unhealthy(client):
    response = client.post(
        "/render",
        headers={"Authorization": "Bearer test-secret"},
        json={"contractVersion": "1.0", "provider": "VST3", "trackModel": {"id": "t", "notes": []},
              "sampleRate": 48000, "durationSeconds": 1.0, "parameters": {}},
    )
    assert response.status_code == 503


def test_unset_token_fails_closed(monkeypatch, tmp_path):
    monkeypatch.delenv("VST3_RENDER_TOKEN", raising=False)
    monkeypatch.setenv("VST3_RENDER_ASSET_MANIFEST", str(tmp_path / "none.json"))
    import app as app_module

    importlib.reload(app_module)
    from fastapi.testclient import TestClient

    response = TestClient(app_module.app).get("/health", headers={"Authorization": "Bearer anything"})
    assert response.status_code == 503
