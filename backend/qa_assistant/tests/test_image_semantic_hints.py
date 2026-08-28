"""Regression tests for the image semantic hints fed into the LLM prompt.

The QA prompt lists an "图片目录（IMG 标记 -> 图片语义）" so the model can decide
which paragraph deserves an ``[[IMG:N-M#K]]`` anchor.  Before these helpers the
catalogue only had markdown-derived captions, which for OCR'd documents are
content hashes like ``307b272.jpg`` — semantically empty, so the model never
emitted an anchor and no image was ever injected.  The vision-model
descriptions persisted on the chunk's ``enhanced_text`` are the real signal.
"""

import sys
import unittest
from pathlib import Path

QA_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]
for path in (QA_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from rag.retrieval_helpers import (
    build_image_semantic_hint,
    extract_image_descriptions,
    summarize_image_description,
)


# Shape produced by data_process ingestion `_build_enhanced_chunk_text`: one
# block appended per unique description, separated by a blank line.
TITLE_DESCRIPTION = (
    "根据您提供的图片（标题为“后海中心区地块编号体系图”）及上下文信息，"
    "以下是对该图在片区管控中的专业解读：\n\n"
    "## 一、图纸性质\n"
    "该图为后海中心区法定图则的地块编号索引图，展示了各街坊的编号规则。"
)
IDENTITY_DESCRIPTION = (
    "您提供的图片及上下文信息，以下是专业解析："
    "该图纸为空中连接体控制图，标注了二层连廊的位置。"
)


class ExtractImageDescriptionsTests(unittest.TestCase):
    def test_parses_blocks_in_document_order(self):
        enhanced = (
            "正文内容 ![](images/307b272.jpg) 更多文字\n\n"
            f"[image_description: {TITLE_DESCRIPTION}]\n\n"
            f"[image_description: {IDENTITY_DESCRIPTION}]"
        )

        blocks = extract_image_descriptions(enhanced)

        self.assertEqual(2, len(blocks))
        self.assertTrue(blocks[0].startswith("根据您提供的图片"))
        self.assertIn("空中连接体控制图", blocks[1])

    def test_description_containing_brackets_and_newlines_is_not_truncated(self):
        """Descriptions are multi-section markdown and contain "]" themselves.

        A naive `[^]]+` match would stop at the first inner bracket and lose the
        sentence that actually names the figure.
        """
        enhanced = f"chunk text\n\n[image_description: {TITLE_DESCRIPTION}]"

        blocks = extract_image_descriptions(enhanced)

        self.assertEqual(1, len(blocks))
        self.assertIn("地块编号索引图", blocks[0])

    def test_placeholder_description_yields_empty_slot(self):
        """Ingestion writes a placeholder when the image file was missing.

        The slot must be preserved (callers align by index) but carry no text.
        """
        enhanced = (
            f"[image_description: {TITLE_DESCRIPTION}]\n\n"
            "[image_description: [图片文件未找到]]"
        )

        blocks = extract_image_descriptions(enhanced)

        self.assertEqual(2, len(blocks))
        self.assertEqual("", blocks[1])

    def test_chunk_without_descriptions_returns_empty_list(self):
        self.assertEqual([], extract_image_descriptions("plain chunk text"))
        self.assertEqual([], extract_image_descriptions(""))


class SummarizeImageDescriptionTests(unittest.TestCase):
    def test_prefers_parenthesized_figure_title(self):
        self.assertEqual(
            "后海中心区地块编号体系图",
            summarize_image_description(TITLE_DESCRIPTION),
        )

    def test_falls_back_to_figure_identity_sentence(self):
        summary = summarize_image_description(IDENTITY_DESCRIPTION)

        self.assertTrue(summary.startswith("空中连接体控制图"))
        # Never leak the model's framing about its own answer.
        self.assertNotIn("您提供", summary)
        self.assertNotIn("专业解析", summary)

    def test_placeholder_and_empty_inputs_produce_no_hint(self):
        self.assertEqual("", summarize_image_description("[图片文件未找到]"))
        self.assertEqual("", summarize_image_description("[无法生成描述]"))
        self.assertEqual("", summarize_image_description(""))

    def test_summary_is_clipped_to_one_line(self):
        long_description = "该图为" + ("超长图纸说明" * 60)

        summary = summarize_image_description(long_description, max_chars=40)

        self.assertLessEqual(len(summary), 41)  # 40 chars + ellipsis
        self.assertNotIn("\n", summary)


class BuildImageSemanticHintTests(unittest.TestCase):
    def test_description_wins_over_hash_filename(self):
        """The regression this whole change exists for.

        An OCR'd chunk has no markdown caption and a hash filename, so the old
        catalogue line read "图片1" and the model had nothing to match against.
        """
        hint = build_image_semantic_hint(
            description=TITLE_DESCRIPTION,
            figure="",
            caption="",
            name="307b272aa1f4c8e9d0b2.jpg",
            ordinal=1,
            name_is_usable=False,
        )

        self.assertEqual("后海中心区地块编号体系图", hint)

    def test_document_figure_label_is_prepended_when_it_adds_information(self):
        hint = build_image_semantic_hint(
            description=IDENTITY_DESCRIPTION,
            figure="图3.0.1",
            ordinal=1,
        )

        self.assertTrue(hint.startswith("图3.0.1 "))
        self.assertIn("空中连接体控制图", hint)

    def test_figure_label_is_not_duplicated(self):
        hint = build_image_semantic_hint(
            description="该图为图3.0.1所示的地块划分图",
            figure="图3.0.1",
            ordinal=1,
        )

        self.assertEqual(1, hint.count("图3.0.1"))

    def test_falls_back_to_caption_then_figure_then_ordinal(self):
        self.assertEqual(
            "图3.0.1 地块划分示意",
            build_image_semantic_hint(figure="图3.0.1", caption="地块划分示意", ordinal=1),
        )
        self.assertEqual(
            "图3.0.1",
            build_image_semantic_hint(figure="图3.0.1", ordinal=1),
        )
        self.assertEqual(
            "图片2",
            build_image_semantic_hint(ordinal=2),
        )

    def test_unusable_caption_and_name_are_ignored(self):
        """Opaque hash values must never become the semantic hint."""
        hint = build_image_semantic_hint(
            caption="307b272aa1f4c8e9d0b2",
            name="307b272aa1f4c8e9d0b2.jpg",
            ordinal=3,
            caption_is_usable=False,
            name_is_usable=False,
        )

        self.assertEqual("图片3", hint)


if __name__ == "__main__":
    unittest.main()
