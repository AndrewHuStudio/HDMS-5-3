import importlib
import os
import sys
import unittest
from pathlib import Path


REVIEW_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class ConfigPathResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._cwd = Path.cwd()
        self._env_backup = os.environ.copy()
        if str(REVIEW_ROOT) not in sys.path:
            sys.path.insert(0, str(REVIEW_ROOT))

    def tearDown(self) -> None:
        os.chdir(self._cwd)
        os.environ.clear()
        os.environ.update(self._env_backup)
        sys.modules.pop("core.config", None)

    def _load_config_from(self, workdir: Path):
        os.chdir(workdir)
        module = importlib.import_module("core.config")
        return importlib.reload(module)

    def test_model_storage_path_relative_env_uses_project_root(self) -> None:
        os.environ["MODEL_STORAGE_PATH"] = "./data/model_external"

        config = self._load_config_from(REVIEW_ROOT)

        expected = (PROJECT_ROOT / "data" / "model_external").resolve()
        self.assertEqual(config.MODEL_STORAGE_PATH, expected)

    def test_cache_storage_path_relative_env_uses_project_root(self) -> None:
        os.environ["CACHE_STORAGE_PATH"] = "./data/cache_external"

        config = self._load_config_from(REVIEW_ROOT)

        expected = (PROJECT_ROOT / "data" / "cache_external").resolve()
        self.assertEqual(config.CACHE_STORAGE_PATH, expected)


if __name__ == "__main__":
    unittest.main()
