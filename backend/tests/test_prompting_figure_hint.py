import pathlib
import re
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qa_assistant.rag.prompting import build_prompt


class PromptingFigureHintTest(unittest.TestCase):
    def test_system_prompt_uses_numeric_figure_example(self) -> None:
        messages = build_prompt(question="测试问题", context="")
        system_prompt = messages[0]["content"]

        self.assertNotIn("见图X.X.X", system_prompt)
        self.assertRegex(system_prompt, re.compile(r"见图\d+(?:[.\-]\d+){1,3}"))


if __name__ == "__main__":
    unittest.main()
