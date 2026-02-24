"""
Integration smoke test for MinerU API.

Important:
- Skipped by default unless `MINERU_API_KEY` is available.
- Does not print secrets or exit() at import time (pytest collection must not crash).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> dict[str, str]:
    env_path = ROOT / ".env"
    config: dict[str, str] = {}
    if not env_path.exists():
        return config

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        config[key.strip()] = value.strip().strip("\"'")
    return config


_dotenv = _load_dotenv()
API_KEY = os.environ.get("MINERU_API_KEY") or _dotenv.get("MINERU_API_KEY", "")
BASE_URL = os.environ.get("MINERU_BASE_URL") or _dotenv.get(
    "MINERU_BASE_URL", "https://mineru.net/api/v4"
)


def test_mineru_file_urls_batch_smoke():
    if not API_KEY:
        pytest.skip("MINERU_API_KEY is not set; skipping MinerU integration smoke test")

    file_urls_endpoint = f"{BASE_URL}/file-urls/batch"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    }
    payload = {
        "files": [
            {
                "name": "test.pdf",
                "data_id": "test_123",
                "is_ocr": True,
                "model_version": "vlm",
            }
        ]
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(file_urls_endpoint, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read().decode("utf-8")
            result = json.loads(body)
    except urllib.error.HTTPError as e:
        # Provide a helpful failure message without leaking secrets.
        details = ""
        try:
            details = e.read().decode("utf-8")
        except Exception:
            details = str(e)
        pytest.fail(f"MinerU HTTPError {e.code}: {details}")
    except urllib.error.URLError as e:
        pytest.fail(f"MinerU URLError: {e}")

    assert response.status == 200
    assert result.get("code") in (0, 200), f"Unexpected response: {result!r}"
    data_obj = result.get("data") or {}

    # API seems to sometimes return `file_urls` or `files` depending on version.
    file_urls = data_obj.get("file_urls") or data_obj.get("files")
    assert data_obj.get("batch_id"), f"Missing batch_id: {data_obj!r}"
    assert file_urls, f"Missing file_urls/files: {data_obj!r}"
