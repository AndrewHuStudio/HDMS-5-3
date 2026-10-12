"""Regression tests for the production-facing model defaults."""

from __future__ import annotations

import importlib.util
import shutil
import sys
import uuid
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SELECTED_MODEL = "deepseek-v4.1-flash"


def _load_module(module_path: Path):
    module_name = f"_hdms_model_default_{uuid.uuid4().hex}"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(module_name, None)
    return module


def test_qa_defaults_to_selected_flash_model(monkeypatch, tmp_path):
    monkeypatch.delenv("HDMS_QA_MODEL", raising=False)
    isolated_config = tmp_path / "config.py"
    shutil.copyfile(
        PROJECT_ROOT / "backend/qa_assistant/core/config.py",
        isolated_config,
    )

    config = _load_module(isolated_config)

    assert config.HDMS_QA_MODEL == SELECTED_MODEL


def test_approval_defaults_to_selected_flash_model(monkeypatch):
    monkeypatch.delenv("HDMS_QA_MODEL", raising=False)
    monkeypatch.delenv("HDMS_CHECK_LIST_MODEL", raising=False)

    ai_suggestion = _load_module(
        PROJECT_ROOT / "backend/approval_checklist/routes/ai_suggestion.py"
    )

    assert ai_suggestion.CHECK_LIST_MODEL == SELECTED_MODEL
