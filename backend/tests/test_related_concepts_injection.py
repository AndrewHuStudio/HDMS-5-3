import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from qa_assistant.rag.postprocess.answer import postprocess_answer


class RelatedConceptsInjectionTest(unittest.TestCase):
    def test_does_not_inject_related_concepts_heading_when_missing(self) -> None:
        raw = (
            "## \u68c0\u7d22\u7efc\u8ff0\n\n"
            "> \u68c0\u7d22\u8d44\u6599\u6e05\u5355\n\n"
            "\u9053\u8def\u7f51\u7edc\u8fde\u901a\u5ea6\u662f\u7247\u533a\u53ef\u8fbe\u6027\u7684\u6838\u5fc3\u6307\u6807\u3002\n\n"
            "## \u8be6\u7ec6\u89e3\u6790\n\n"
            "\u6b63\u6587 [1-1]"
        )

        out, _ = postprocess_answer(raw, valid_labels={"1-1"})

        self.assertNotIn("## \u76f8\u5173\u6982\u5ff5", out)

    def test_keeps_model_provided_related_concepts_heading(self) -> None:
        raw = (
            "## \u68c0\u7d22\u7efc\u8ff0\n\n"
            "> \u68c0\u7d22\u8d44\u6599\u6e05\u5355\n\n"
            "## \u76f8\u5173\u6982\u5ff5\n\n"
            "\u9053\u8def\u7f51\u7edc\u8fde\u901a\u5ea6\u7528\u4e8e\u8861\u91cf\u9053\u8def\u7cfb\u7edf\u901a\u884c\u6548\u7387\u3002\n\n"
            "## \u8be6\u7ec6\u89e3\u6790\n\n"
            "\u6b63\u6587 [1-1]"
        )

        out, _ = postprocess_answer(raw, valid_labels={"1-1"})

        self.assertIn("## \u76f8\u5173\u6982\u5ff5", out)


if __name__ == "__main__":
    unittest.main()
