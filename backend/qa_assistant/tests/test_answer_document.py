import sys
import unittest
from pathlib import Path


QA_ROOT = Path(__file__).resolve().parents[1]
if str(QA_ROOT) not in sys.path:
    sys.path.insert(0, str(QA_ROOT))

from rag.postprocess.answer_document import build_answer_document


class AnswerDocumentTests(unittest.TestCase):
    def test_sections_bind_multiple_images_only_from_cited_sources(self):
        answer = "建筑退线应结合道路等级控制。[1-1]\n\n街道界面应保持连续。[2-1]"
        sources = [
            {
                "citation_label": "1-1",
                "images": [
                    {"id": "img-a", "url": "/a.png", "caption": "退线示意图", "source_label": "1-1"},
                    {"id": "img-b", "url": "/b.png", "caption": "道路断面图", "source_label": "1-1"},
                    {"id": "img-invalid", "url": "", "caption": "无效图片", "source_label": "1-1"},
                ],
            },
            {
                "citation_label": "2-1",
                "images": [
                    {"id": "img-a", "url": "/a.png", "caption": "重复图片", "source_label": "2-1"},
                    {"id": "img-c", "url": "/c.png", "caption": "街道界面图", "source_label": "2-1"},
                    {"id": "img-wrong", "url": "/wrong.png", "caption": "错误归属", "source_label": "9-9"},
                ],
            },
            {
                "citation_label": "3-1",
                "images": [
                    {"id": "img-d", "url": "/d.png", "caption": "未引用图片", "source_label": "3-1"},
                ],
            },
        ]

        document = build_answer_document(answer, sources)

        self.assertEqual(2, len(document["sections"]))
        first, second = document["sections"]
        self.assertEqual("section-1", first["id"])
        self.assertEqual(["1-1"], first["source_labels"])
        self.assertEqual(["img-a", "img-b"], [image["id"] for image in first["images"]])
        self.assertEqual(["2-1"], second["source_labels"])
        self.assertEqual(["img-c"], [image["id"] for image in second["images"]])
        self.assertNotIn("img-d", str(document))

    def test_section_without_citation_keeps_text_and_has_no_images(self):
        document = build_answer_document("结论概述。", [])

        self.assertEqual("结论概述。", document["sections"][0]["markdown"])
        self.assertEqual([], document["sections"][0]["source_labels"])
        self.assertEqual([], document["sections"][0]["images"])

    def test_model_markdown_images_cannot_bypass_validated_bindings(self):
        answer = "退线要求如下。![模型复制的图片](/rag/documents/doc-1/image?ref=raw.png)[1-1]"
        sources = [
            {
                "citation_label": "1-1",
                "images": [
                    {"id": "img-a", "url": "/verified.png", "caption": "已验证退线图", "source_label": "1-1"},
                ],
            }
        ]

        document = build_answer_document(answer, sources)

        self.assertNotIn("![", document["sections"][0]["markdown"])
        self.assertNotIn("raw.png", document["sections"][0]["markdown"])
        self.assertEqual(["img-a"], [image["id"] for image in document["sections"][0]["images"]])


if __name__ == "__main__":
    unittest.main()
