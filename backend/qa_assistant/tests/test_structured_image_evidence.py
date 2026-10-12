import sys
import unittest
from pathlib import Path


QA_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]
for path in (QA_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from rag import context_builder as rag_context_builder
from rag import retrieval_helpers as rag_retrieval
from rag.postprocess import images as pp_images
from rag.postprocess import markdown as pp_markdown


class FakeMongo:
    def __init__(self, chunk):
        self.chunk = chunk

    def find_by_id(self, collection, chunk_id):
        assert collection == "chunks"
        return self.chunk if chunk_id == "chunk-1" else None


class StructuredImageEvidenceTests(unittest.TestCase):
    def test_source_exposes_stable_aligned_image_records(self):
        text = (
            "图3.0.1 建筑退线控制示意图\n\n![](images/setback.png)\n\n"
            "图3.0.2 街道界面控制图\n\n![](images/frontage.png)"
        )
        enhanced = (
            f"{text}\n\n"
            "[image_description: 该图为建筑退线控制示意图，展示红线与建筑边界。]\n\n"
            "[image_description: 该图为街道界面控制图，展示连续街墙。]"
        )
        results = {
            "fused_results": [
                {
                    "id": "chunk-1",
                    "doc_id": "doc-1",
                    "source": "vector",
                    "text": text,
                    "metadata": {
                        "file_name": "城市设计导则.pdf",
                        "section_title": "退线控制",
                        "page": 18,
                    },
                }
            ]
        }

        context, sources = rag_context_builder.build_context_and_sources(
            retrieval_results=results,
            query="建筑退线如何控制？",
            mongo=FakeMongo({"doc_id": "doc-1", "enhanced_text": enhanced}),
            ranked_results_contain_relevant_images=lambda _results, _query: True,
            search_image_chunks_by_text=lambda _query, _limit: [],
            extract_image_refs=pp_images.extract_image_refs,
            extract_image_figure_meta=pp_images.extract_image_figure_meta,
            extract_image_descriptions=rag_retrieval.extract_image_descriptions,
            build_image_semantic_hint=rag_retrieval.build_image_semantic_hint,
            rewrite_image_urls=pp_images.rewrite_image_urls,
            extract_first_markdown_table=pp_markdown.extract_first_markdown_table,
            pdf_is_available=lambda _name: True,
            parse_page_like=lambda value: (int(value), None) if value else (None, None),
            infer_page_range_from_text=lambda _text: (None, None),
        )

        images = sources[0]["images"]
        self.assertEqual(2, len(images))
        self.assertNotEqual(images[0]["id"], images[1]["id"])
        self.assertTrue(images[0]["id"].startswith("img-"))
        self.assertEqual("1-1", images[0]["source_label"])
        self.assertEqual("doc-1", images[0]["doc_id"])
        self.assertEqual(18, images[0]["page"])
        self.assertEqual("图3.0.1", images[0]["figure"])
        self.assertIn("建筑退线", images[0]["caption"])
        self.assertIn("ref=images/setback.png", images[0]["url"])
        self.assertEqual(images, sources[0]["images"])
        self.assertNotIn("[[IMG:", context)
        self.assertNotIn("图片目录", context)
        self.assertNotIn("![", context)
        self.assertNotIn("/rag/documents/", context)


if __name__ == "__main__":
    unittest.main()
