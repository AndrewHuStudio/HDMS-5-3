from __future__ import annotations

import os

from data_process.gradio_app.launch_env import ensure_loopback_no_proxy


def test_adds_loopback_entries_when_no_proxy_missing(monkeypatch):
    monkeypatch.delenv("NO_PROXY", raising=False)
    monkeypatch.delenv("no_proxy", raising=False)

    ensure_loopback_no_proxy()

    value = os.environ.get("NO_PROXY") or ""
    assert "127.0.0.1" in value
    assert "localhost" in value


def test_preserves_existing_entries(monkeypatch):
    monkeypatch.setenv("NO_PROXY", "example.com")

    ensure_loopback_no_proxy()

    value = os.environ.get("NO_PROXY") or ""
    assert "example.com" in value
    assert "localhost" in value
    assert "127.0.0.1" in value
