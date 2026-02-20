import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.postprocess import answer as pp_answer


def test_related_concepts_first_subheading_is_converted_to_body_text():
    text = "\n".join(
        [
            "## 相关概念",
            "",
            "### 贴线率是衡量建筑立面沿街界面连续性的重要指标",
            "",
            "## 详细解析",
        ]
    )

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert "### 贴线率是衡量建筑立面沿街界面连续性的重要指标" not in out
    assert "贴线率是衡量建筑立面沿街界面连续性的重要指标" in out


def test_non_related_section_subheading_is_kept():
    text = "\n".join(
        [
            "## 详细解析",
            "",
            "### 一、计算方法与公式",
        ]
    )

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert "### 一、计算方法与公式" in out


def test_related_concepts_first_h2_heading_is_converted_to_body_text():
    text = "\n".join(
        [
            "## 相关概念",
            "",
            "## 城市高强度片区环境性能评估是以公共开放空间为核心对象",
            "",
            "## 详细解析",
        ]
    )

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert "## 城市高强度片区环境性能评估是以公共开放空间为核心对象" not in out
    assert "城市高强度片区环境性能评估是以公共开放空间为核心对象" in out
    assert "## 详细解析" in out


def test_related_concepts_title_with_bold_wrapper_still_converts_first_h2_body():
    text = "\n".join(
        [
            "## **相关概念**",
            "",
            "## **城市高强度片区环境性能评估是以公共开放空间为核心对象**",
            "",
            "## **详细解析**",
        ]
    )

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert "## **城市高强度片区环境性能评估是以公共开放空间为核心对象**" not in out
    assert "城市高强度片区环境性能评估是以公共开放空间为核心对象" in out
    assert "## **详细解析**" in out


def test_missing_related_concepts_heading_is_inserted_before_intermediate_h2():
    text = "\n".join(
        [
            "## 检索综述",
            "",
            "> 检索资料清单与引用分析...",
            "",
            "## 贴线率计算方法",
            "",
            "## 详细解析",
        ]
    )

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert "## 相关概念" in out
    assert out.index("## 相关概念") < out.index("## 详细解析")
    assert "## 贴线率计算方法" not in out
    assert "贴线率计算方法" in out


def test_multiple_subheadings_under_related_concepts_all_demoted():
    """Regression: all headings inside the section should become body text,
    not just the first one."""
    text = "\n".join(
        [
            "## 相关概念",
            "",
            "### 贴线率",
            "贴线率是衡量建筑立面沿街界面连续性的重要指标。",
            "### 建筑密度",
            "建筑密度反映地块的开发强度。",
            "",
            "## 详细解析",
        ]
    )

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert "### 贴线率" not in out
    assert "### 建筑密度" not in out
    assert "贴线率" in out
    assert "建筑密度" in out
    assert "## 详细解析" in out


def test_missing_related_concepts_heading_inserted_for_plain_text_content():
    """Regression: when content between overview and detailed is plain text
    (no heading), the section heading should still be inserted."""
    text = "\n".join(
        [
            "## 检索综述",
            "",
            "> 检索资料清单与引用分析...",
            "",
            "贴线率是衡量建筑立面沿街界面连续性的重要指标。",
            "",
            "## 详细解析",
        ]
    )

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert "## 相关概念" in out
    assert out.index("## 相关概念") < out.index("## 详细解析")
    assert "贴线率是衡量建筑立面沿街界面连续性的重要指标" in out


def test_ensure_blank_line_after_inserted_related_concepts_heading():
    """Regression: inserted heading must have a blank line after it so the
    next line is parsed as a separate paragraph, not swallowed into the heading."""
    text = "\n".join(
        [
            "## 检索综述",
            "",
            "> 检索资料清单与引用分析...",
            "",
            "## 贴线率计算方法",
            "这是正文内容。",
            "",
            "## 详细解析",
        ]
    )

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    # The heading should be followed by a blank line, then the body text.
    idx = out.index("## 相关概念")
    after_heading = out[idx + len("## 相关概念"):]
    assert after_heading.startswith("\n\n") or after_heading.startswith("\n \n")


def test_related_concepts_setext_heading_underline_is_removed():
    """Regression: avoid accidental setext h2 rendering inside related concepts."""
    text = "\n".join(
        [
            "## 相关概念",
            "道路网络连通度是评估高强度片区交通效率的核心指标。",
            "---",
            "",
            "## 详细解析",
        ]
    )

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert "道路网络连通度是评估高强度片区交通效率的核心指标。" in out
    assert "\n---\n" not in out
    assert "## 详细解析" in out
