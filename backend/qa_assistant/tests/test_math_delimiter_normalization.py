import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.postprocess import answer as pp_answer


def test_postprocess_converts_block_latex_brackets_to_dollars():
    # Frontend renders $$...$$ reliably; \[...\] may display as raw text.
    text = r"基本公式：\[ \text{贴线率} = \frac{A}{B} \times 100\% \]"

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert r"\[" not in out
    assert r"\]" not in out
    assert "$$" in out


def test_postprocess_converts_inline_latex_parentheses_to_dollars():
    text = r"其中\(\text{Z值}\geq 0\)为分母。"

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert r"\(" not in out
    assert r"\)" not in out
    assert "$" in out


def test_postprocess_does_not_touch_code_blocks():
    text = "```latex\n\\[ a = b \\]\n```\n"

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    # Leave code blocks untouched.
    assert "\\[ a = b \\]" in out


def test_postprocess_does_not_convert_unmatched_inline_delimiters():
    # In production, model output may contain only opening \(. Converting it
    # directly to "$" creates unmatched math and breaks rendering.
    text = r"重点核查（\text{挠度} \leq \frac{L}{\text{250})"

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert r"\text{挠度}" in out
    assert "($" not in out


def test_postprocess_unescapes_escaped_dollar_math_delimiters():
    text = r"形态审查：(\$\text{挠度}\leq \frac{L}{\text{250}}\$)。"

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert r"\$\text" not in out
    assert "$\\text{挠度}\\leq \\frac{L}{\\text{250}}$" in out


def test_postprocess_wraps_bare_latex_inequality_without_delimiters():
    text = r"该指标通过分级管控（一级 ≥ 70、 \text{二级} \geq \text{50%}）实现差异化塑造。"

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert "$\\text{一级} \\geq 70$" in out
    assert "$\\text{二级} \\geq \\text{50%}$" in out


def test_postprocess_normalizes_text_parenthesis_and_wraps_bare_latex():
    text = r"分级要求：\text(二级) \geq \text{50%}。"

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert r"\text(二级)" not in out
    assert "$\\text{二级} \\geq \\text{50%}$" in out
