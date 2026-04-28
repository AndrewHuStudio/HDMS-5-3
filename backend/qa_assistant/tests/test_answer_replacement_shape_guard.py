import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rag.service import _should_emit_answer_replacement


class AnswerReplacementShapeGuardTests(unittest.TestCase):
    def test_rejects_ordered_list_downgrade_to_bullets(self):
        current = (
            "## 二、合规核查要点\n\n"
            "1. 空间分区合规性\n"
            "    - 核查地下层是否严格划分停车区、设备区。\n"
            "2. 高度与尺度匹配\n"
            "    - 验证建筑高度是否不超过8.4米限值。"
        )
        replacement = (
            "## 二、合规核查要点\n\n"
            "- 空间分区合规性\n"
            "    - 核查地下层是否严格划分停车区、设备区。\n"
            "- 高度与尺度匹配\n"
            "    - 验证建筑高度是否不超过8.4米限值。"
        )

        accepted, reason = _should_emit_answer_replacement(current, replacement)

        self.assertFalse(accepted)
        self.assertEqual("ordered-list-lost", reason)

    def test_rejects_nested_ordered_list_flattening_into_top_level(self):
        current = (
            "## 二、合规核查要点\n\n"
            "1. 一级核查\n"
            "    1. 二级核查\n"
            "        - 细项A\n"
            "2. 另一个一级核查\n"
            "    - 细项B"
        )
        replacement = (
            "## 二、合规核查要点\n\n"
            "1. 一级核查\n"
            "2. 二级核查\n"
            "    - 细项A\n"
            "3. 另一个一级核查\n"
            "    - 细项B"
        )

        accepted, reason = _should_emit_answer_replacement(current, replacement)

        self.assertFalse(accepted)
        self.assertEqual("ordered-list-nesting-lost", reason)


if __name__ == "__main__":
    unittest.main()
