from __future__ import annotations

import pytest

from data_process.core.database.manager import DatabaseManager


def test_ensure_initialized_retries_until_success(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = DatabaseManager()
    attempts = {"count": 0}

    def flaky_initialize() -> None:
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise RuntimeError("milvus not ready")
        manager._initialized = True

    monkeypatch.setattr(manager, "initialize", flaky_initialize)
    manager.ensure_initialized(max_retries=3, retry_delay_seconds=0.01)

    assert manager._initialized is True
    assert attempts["count"] == 3


def test_ensure_initialized_raises_after_retry_exhausted(monkeypatch: pytest.MonkeyPatch) -> None:
    manager = DatabaseManager()
    attempts = {"count": 0}

    def always_fails() -> None:
        attempts["count"] += 1
        raise RuntimeError("still unavailable")

    monkeypatch.setattr(manager, "initialize", always_fails)
    with pytest.raises(RuntimeError, match="still unavailable"):
        manager.ensure_initialized(max_retries=2, retry_delay_seconds=0.01)

    assert attempts["count"] == 2
