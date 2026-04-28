import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rag.postprocess.citations import normalize_citations


class CitationNormalizationIndentTests(unittest.TestCase):
    def test_preserves_nested_list_indentation_when_remapping_citations(self):
        text = (
            "1. 一级核查[1-8]\n"
            "    1. 二级核查[1-9]\n"
            "        - 细项A[1-10]\n"
            "2. 另一个一级核查[1-11]\n"
            "    - 细项B[1-12]"
        )

        normalized, remap = normalize_citations(text)

        self.assertIn("\n    1. 二级核查[1-2]", normalized)
        self.assertIn("\n        - 细项A[1-3]", normalized)
        self.assertIn("\n    - 细项B[1-5]", normalized)
        self.assertEqual(
            {
                "1-8": "1-1",
                "1-9": "1-2",
                "1-10": "1-3",
                "1-11": "1-4",
                "1-12": "1-5",
            },
            remap,
        )


if __name__ == "__main__":
    unittest.main()
