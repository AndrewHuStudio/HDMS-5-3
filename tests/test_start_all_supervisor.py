from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "start_all.py"
SPEC = importlib.util.spec_from_file_location("start_all", MODULE_PATH)
assert SPEC and SPEC.loader
start_all = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = start_all
SPEC.loader.exec_module(start_all)


def test_restart_backoff_seconds_grows_and_caps():
    assert math.isclose(start_all._restart_backoff_seconds(1.0, 16.0, 0), 1.0)
    assert math.isclose(start_all._restart_backoff_seconds(1.0, 16.0, 1), 2.0)
    assert math.isclose(start_all._restart_backoff_seconds(1.0, 16.0, 2), 4.0)
    assert math.isclose(start_all._restart_backoff_seconds(1.0, 16.0, 10), 16.0)


def test_parse_args_supports_restart_settings():
    args = start_all._parse_args([
        "--restart-mode",
        "on",
        "--restart-delay",
        "2",
        "--restart-max-delay",
        "9",
    ])

    assert args.restart_mode == "on"
    assert math.isclose(args.restart_delay, 2.0)
    assert math.isclose(args.restart_max_delay, 9.0)


def test_parse_args_uses_safe_defaults_for_invalid_restart_env(monkeypatch):
    monkeypatch.setenv("HDMS_AUTO_RESTART", "invalid")
    monkeypatch.setenv("HDMS_RESTART_DELAY", "bad-value")
    monkeypatch.setenv("HDMS_RESTART_MAX_DELAY", "")

    args = start_all._parse_args([])

    assert args.restart_mode == "on"
    assert math.isclose(args.restart_delay, 1.0)
    assert math.isclose(args.restart_max_delay, 30.0)
