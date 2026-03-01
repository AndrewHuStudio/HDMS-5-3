"""Configuration helpers for approval_checklist."""
from __future__ import annotations

import os
from pathlib import Path


def _find_env_file(start_path: Path | None = None) -> Path | None:
    """Find the nearest .env by walking up from the provided path."""
    anchor = (start_path or Path(__file__)).resolve()
    current = anchor if anchor.is_dir() else anchor.parent
    for parent in [current, *current.parents]:
        candidate = parent / ".env"
        if candidate.exists():
            return candidate
    return None


def load_env_file(start_path: Path | None = None) -> Path | None:
    """
    Load .env values into os.environ without overriding existing variables.

    Returns the loaded .env path, or None when no file was found/readable.
    """
    env_path = _find_env_file(start_path=start_path)
    if not env_path:
        return None

    try:
        content = env_path.read_text(encoding="utf-8")
    except OSError:
        return None

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'").strip()
        if key and key not in os.environ:
            os.environ[key] = value

    return env_path

