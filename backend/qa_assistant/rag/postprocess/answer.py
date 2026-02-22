from typing import Dict, Optional, Tuple

from . import citations as pp_citations
from . import markdown as pp_markdown
from . import math as pp_math


def sanitize_answer(text: str) -> str:
    """Structural cleanup of LLM output before citation/formula processing."""
    return pp_markdown.sanitize_answer(text)


def convert_formulas_to_latex(text: str) -> str:
    """Convert formula-like text into frontend-renderable LaTeX."""
    if not text:
        return text
    out = pp_math.convert_plain_formulas_to_latex(text)
    out = pp_math.normalize_bare_latex_math(out)
    return out


def postprocess_answer(text: str, valid_labels: Optional[set] = None) -> Tuple[str, Dict[str, str]]:
    """Apply all post-processing steps to an LLM answer."""
    text = sanitize_answer(text)
    text = pp_markdown.normalize_markdown_image_syntax(text)
    text = pp_markdown.strip_disallowed_markdown_images(text)
    text = pp_math.unescape_dollar_delimiters(text)
    text, remap = pp_citations.normalize_citations(text, valid_labels)
    text = pp_math.normalize_math_delimiters(text)
    text = convert_formulas_to_latex(text)
    return text, remap
