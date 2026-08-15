import sys
import unittest
from pathlib import Path

QA_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]
for path in (QA_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from rag.postprocess.sources import filter_sources_to_referenced


class SourceFilterPreservesFusionAssetsTests(unittest.TestCase):
    def test_keeps_uncited_document_sources_when_requested(self):
        sources = [
            {"type": "document", "citation_label": "1-1", "name": "标准.pdf"},
            {"type": "document", "citation_label": "2-1", "name": "指南.pdf"},
            {"type": "graph", "citation_label": "1", "name": "门诊"},
        ]

        filtered = filter_sources_to_referenced(
            sources,
            referenced_labels={"1-1"},
            keep_uncited_document_sources=True,
        )

        labels = [item["citation_label"] for item in filtered]
        self.assertEqual(labels, ["1-1", "2-1", "1"])

    def test_keeps_image_sources_even_when_answer_does_not_cite_them(self):
        sources = [
            {"type": "document", "citation_label": "1-1", "name": "标准.pdf"},
            {
                "type": "document",
                "citation_label": "2-1",
                "name": "指南.pdf",
                "image_urls": ["/rag/documents/doc-b/image?ref=images/a.png"],
            },
        ]

        filtered = filter_sources_to_referenced(
            sources,
            referenced_labels={"1-1"},
            keep_image_sources=True,
            keep_uncited_document_sources=False,
        )

        self.assertEqual([item["citation_label"] for item in filtered], ["1-1", "2-1"])
        self.assertEqual(filtered[1]["image_urls"], ["/rag/documents/doc-b/image?ref=images/a.png"])


if __name__ == "__main__":
    unittest.main()
