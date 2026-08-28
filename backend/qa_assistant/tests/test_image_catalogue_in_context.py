"""Regression tests for the image catalogue embedded in the LLM context.

`build_context_and_sources` renders an "图片目录（IMG 标记 -> 图片语义）" block per
chunk so the model can emit `[[IMG:N-M#K]]` anchors in the right paragraphs.
These tests pin the real wiring (service -> context_builder -> retrieval_helpers)
rather than stubbing the builder, because the defect being fixed lived exactly in
that seam: the catalogue was built from hash filenames instead of the vision
descriptions persisted on the chunk.
"""

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


GEOMETRY_DESCRIPTION = (
    "根据您提供的图片（标题为“后海中心区地块编号体系图”）及上下文信息，"
    "以下是对该图的专业解读：\n\n## 一、图纸性质\n"
    "该图为后海中心区法定图则的地块编号索引图。"
)
BRIDGE_DESCRIPTION = (
    "您提供的图片及上下文信息，以下是专业解析："
    "该图纸为空中连接体控制图，标注了二层连廊的位置。"
)


class FakeMongo:
    """Minimal stand-in for the Mongo accessor used by the context builder."""

    def __init__(self, chunks):
        self._chunks = chunks

    def find_by_id(self, collection, chunk_id):
        assert collection == "chunks"
        return self._chunks.get(chunk_id)


def build_context(chunk_text, enhanced_text, *, chunk_id="chunk-1", doc_id="doc-1"):
    """Run the real builder with the same collaborators `RAGService` passes in."""
    retrieval_results = {
        "fused_results": [
            {
                "id": chunk_id,
                "doc_id": doc_id,
                "source": "vector",
                "text": chunk_text,
                "metadata": {"file_name": "后海中心区法定图则.pdf", "section_title": "地块编号"},
            }
        ]
    }
    mongo = FakeMongo({chunk_id: {"doc_id": doc_id, "enhanced_text": enhanced_text}})

    return rag_context_builder.build_context_and_sources(
        retrieval_results=retrieval_results,
        query="后海中心区的地块编号体系是怎样的？",
        mongo=mongo,
        # The image-boost path is irrelevant here: the chunk already has images.
        ranked_results_contain_relevant_images=lambda _results, _query: True,
        search_image_chunks_by_text=lambda _query, _limit: [],
        extract_image_refs=pp_images.extract_image_refs,
        extract_image_figure_meta=pp_images.extract_image_figure_meta,
        extract_image_descriptions=rag_retrieval.extract_image_descriptions,
        build_image_semantic_hint=rag_retrieval.build_image_semantic_hint,
        rewrite_image_urls=pp_images.rewrite_image_urls,
        extract_first_markdown_table=pp_markdown.extract_first_markdown_table,
        pdf_is_available=lambda _name: True,
        parse_page_like=lambda _value: (None, None),
        infer_page_range_from_text=lambda _text: (None, None),
    )


class ImageCatalogueTests(unittest.TestCase):
    def test_catalogue_uses_vision_description_instead_of_hash_filename(self):
        """The core regression.

        With only a hash filename available the catalogue line degraded to
        "图片1", giving the model no reason to anchor an image to any paragraph,
        so `[[IMG:N-M#K]]` never appeared in the stream.
        """
        chunk_text = "地块编号规则如下。\n\n![](images/307b272aa1f4c8e9d0b2.jpg)"
        enhanced = f"{chunk_text}\n\n[image_description: {GEOMETRY_DESCRIPTION}]"

        context, sources = build_context(chunk_text, enhanced)

        self.assertIn("[[IMG:1-1#1]] 后海中心区地块编号体系图", context)
        self.assertNotIn("图片1", context)
        # The hash must never reach the prompt as a semantic hint.
        self.assertNotIn("307b272aa1f4c8e9d0b2 ", context)
        # The source carries the same condensed hint the prompt saw, so the
        # frontend's figure captions and the model's catalogue cannot diverge.
        self.assertEqual(
            ["后海中心区地块编号体系图"], sources[0]["image_hints"]
        )
        # The raw description stays available for callers that want the detail.
        self.assertEqual([GEOMETRY_DESCRIPTION], sources[0]["image_descriptions"])

    def test_anchor_ordinals_align_with_image_order(self):
        chunk_text = (
            "编号体系见下图。\n\n![](images/aaa1111bbb2222ccc3333.jpg)\n\n"
            "连接体控制见下图。\n\n![](images/ddd4444eee5555fff6666.jpg)"
        )
        enhanced = (
            f"{chunk_text}\n\n"
            f"[image_description: {GEOMETRY_DESCRIPTION}]\n\n"
            f"[image_description: {BRIDGE_DESCRIPTION}]"
        )

        context, sources = build_context(chunk_text, enhanced)

        self.assertIn("[[IMG:1-1#1]] 后海中心区地块编号体系图", context)
        self.assertIn("[[IMG:1-1#2]] 空中连接体控制图", context)
        self.assertEqual(2, len(sources[0]["image_urls"]))
        self.assertEqual("本片段包含 2 张图片" in context, True)

    def test_description_count_mismatch_drops_descriptions_rather_than_mislabel(self):
        """Ingestion de-duplicates descriptions by text.

        When two images share one description the counts disagree and there is no
        way to tell which image the block belongs to, so pairing by index would
        caption the wrong figure.  The builder must fall back instead.
        """
        chunk_text = (
            "![](images/aaa1111bbb2222ccc3333.jpg)\n\n"
            "![](images/ddd4444eee5555fff6666.jpg)"
        )
        enhanced = f"{chunk_text}\n\n[image_description: {GEOMETRY_DESCRIPTION}]"

        context, sources = build_context(chunk_text, enhanced)

        self.assertNotIn("后海中心区地块编号体系图", context)
        # The ambiguous description is dropped entirely rather than guessed at.
        self.assertEqual([], sources[0]["image_descriptions"])
        # No usable hint survives, so both fall back to the ordinal placeholder.
        self.assertEqual(["图片1", "图片2"], sources[0]["image_hints"])
        # Anchors are still offered so the model can reference the images.
        self.assertIn("[[IMG:1-1#1]]", context)
        self.assertIn("[[IMG:1-1#2]]", context)

    def test_chunk_without_images_has_no_catalogue(self):
        chunk_text = "纯文字段落，没有任何插图。"

        context, sources = build_context(chunk_text, chunk_text)

        self.assertNotIn("[[IMG:", context)
        self.assertNotIn("图片目录", context)
        self.assertEqual([], sources[0]["image_urls"])

    def test_markdown_caption_is_kept_when_no_description_exists(self):
        """Documents converted with real captions must not regress."""
        chunk_text = "图3.0.1 地块编号体系\n\n![](images/plan.png)"

        context, _sources = build_context(chunk_text, chunk_text)

        self.assertIn("[[IMG:1-1#1]] 图3.0.1 地块编号体系", context)


if __name__ == "__main__":
    unittest.main()
