import sys
import unittest
from pathlib import Path
from unittest.mock import patch

QA_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]
for path in (QA_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from routes import qa as qa_routes


class ProjectRootWithoutEnvFileTest(unittest.TestCase):
    """
    Production containers inject config as environment variables and ship no
    `.env` file. `_find_project_root` must still resolve to the directory that
    holds `data/`, otherwise `_iter_pdf_roots` returns an empty list and every
    PDF request 404s even though the files are present.

    Container layout: /app/backend/qa_assistant/routes/qa.py with /app/data.
    """

    def test_resolves_repo_root_when_no_env_file_exists(self):
        with patch.object(Path, "exists", return_value=False):
            root = qa_routes._find_project_root()

        expected = Path(qa_routes.__file__).resolve().parents[3]
        self.assertEqual(root, expected)

    def test_pdf_roots_found_without_env_file(self):
        real_exists = Path.exists

        def exists_without_env(self):
            if self.name == ".env":
                return False
            return real_exists(self)

        with patch.object(Path, "exists", exists_without_env):
            root = qa_routes._find_project_root()
            roots = qa_routes._iter_pdf_roots(root)

        self.assertTrue(
            roots,
            "no PDF roots resolved without a .env file; PDF lookup would always 404",
        )

    def test_prefers_env_file_directory_when_present(self):
        """Local dev keeps working: an actual .env directory still wins."""
        root = qa_routes._find_project_root()
        if (root / ".env").exists():
            self.assertTrue((root / ".env").exists())
        else:
            self.skipTest("no .env in this checkout")


if __name__ == "__main__":
    unittest.main()
