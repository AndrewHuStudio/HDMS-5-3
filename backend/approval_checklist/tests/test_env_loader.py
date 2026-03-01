import os
import sys
import tempfile
import unittest
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))


class EnvLoaderTests(unittest.TestCase):
    def test_load_env_file_reads_missing_values_from_repo_env(self) -> None:
        from core.config import load_env_file

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            env_file = root / ".env"
            env_file.write_text(
                "\n".join(
                    [
                        "HDMS_API_KEY=test-key-from-env-file",
                        "HDMS_BASE_URL=https://example.test/v1",
                    ]
                ),
                encoding="utf-8",
            )

            start_path = root / "backend" / "approval_checklist" / "app.py"
            start_path.parent.mkdir(parents=True, exist_ok=True)
            start_path.write_text("# marker", encoding="utf-8")

            old_api_key = os.environ.pop("HDMS_API_KEY", None)
            old_base_url = os.environ.pop("HDMS_BASE_URL", None)
            try:
                loaded_path = load_env_file(start_path=start_path)
                self.assertEqual(loaded_path, env_file)
                self.assertEqual(os.environ.get("HDMS_API_KEY"), "test-key-from-env-file")
                self.assertEqual(os.environ.get("HDMS_BASE_URL"), "https://example.test/v1")
            finally:
                if old_api_key is None:
                    os.environ.pop("HDMS_API_KEY", None)
                else:
                    os.environ["HDMS_API_KEY"] = old_api_key
                if old_base_url is None:
                    os.environ.pop("HDMS_BASE_URL", None)
                else:
                    os.environ["HDMS_BASE_URL"] = old_base_url

    def test_load_env_file_does_not_override_existing_environment(self) -> None:
        from core.config import load_env_file

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            env_file = root / ".env"
            env_file.write_text(
                "HDMS_API_KEY=env-file-value\n",
                encoding="utf-8",
            )

            start_path = root / "backend" / "approval_checklist" / "app.py"
            start_path.parent.mkdir(parents=True, exist_ok=True)
            start_path.write_text("# marker", encoding="utf-8")

            old_api_key = os.environ.get("HDMS_API_KEY")
            os.environ["HDMS_API_KEY"] = "already-set-in-process"
            try:
                loaded_path = load_env_file(start_path=start_path)
                self.assertEqual(loaded_path, env_file)
                self.assertEqual(os.environ.get("HDMS_API_KEY"), "already-set-in-process")
            finally:
                if old_api_key is None:
                    os.environ.pop("HDMS_API_KEY", None)
                else:
                    os.environ["HDMS_API_KEY"] = old_api_key


if __name__ == "__main__":
    unittest.main()
