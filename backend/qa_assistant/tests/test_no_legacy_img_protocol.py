import sys
import unittest
from pathlib import Path


QA_ROOT = Path(__file__).resolve().parents[1]
if str(QA_ROOT) not in sys.path:
    sys.path.insert(0, str(QA_ROOT))

from rag.prompting import build_prompt


class NoLegacyImageProtocolTests(unittest.TestCase):
    def test_prompt_does_not_teach_model_img_anchors(self):
        messages = build_prompt(
            question="建筑退线如何控制？",
            context="[1-1] 来源：城市设计导则.pdf\n建筑退线应结合道路等级控制。",
            source_doc_nums=[1],
            source_doc_required_labels={1: "1-1"},
        )

        prompt = "\n".join(message["content"] for message in messages)
        self.assertNotIn("[[IMG:", prompt)
        self.assertNotIn("IMG 标记", prompt)
        self.assertIn("[N-M]", prompt)

    def test_answer_postprocessor_has_no_img_anchor_stage(self):
        source = (QA_ROOT / "rag" / "postprocess" / "answer.py").read_text(encoding="utf-8")

        self.assertNotIn("normalize_image_reference_markers", source)
        self.assertNotIn("remap_structured_image_markers", source)


if __name__ == "__main__":
    unittest.main()
