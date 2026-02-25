from typing import Dict, Optional, Tuple

from . import citations as pp_citations
from . import markdown as pp_markdown
from . import math as pp_math
from . import images as pp_images


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
    """Apply all post-processing steps to an LLM answer.

    Data-layer only — all rendering/formatting is handled by the frontend
    normalize-rules pipeline to avoid double-processing that breaks
    streaming ↔ final consistency.

    Removed (now frontend-only):
      - sanitize_answer          (h1 demote, related-concepts body, list blank lines, think tags)
      - normalize_markdown_image_syntax   (image math unwrap)
      - strip_disallowed_markdown_images  (unrenderable image cleanup)
      - normalize_math_delimiters         (\\[→$$, \\(→$)
      - convert_formulas_to_latex         (plain formula → LaTeX)

    Kept (data-layer, frontend cannot do these):
      - _ensure_related_concepts_section  (structural section injection)
      - _SECTION_PAREN_RE / _CITE_WITH_SECTION_RE cleanup (data noise)
      - normalize_image_reference_markers (structured [[IMG:N-M]] protocol)
      - unescape_dollar_delimiters        (LLM output \\$ fix)
      - normalize_citations               (chunk_id remap)
    """
    # Data-layer structural cleanup (no rendering changes).
    text = pp_markdown.sanitize_answer_data_only(text)
    # Structured image markers (frontend depends on this protocol).
    text = pp_images.normalize_image_reference_markers(text, valid_labels)
    # Fix escaped dollar delimiters from LLM output.
    text = pp_math.unescape_dollar_delimiters(text)
    # Citation dedup and index remap (needs chunk_id mapping).
    text, remap = pp_citations.normalize_citations(text, valid_labels)
    return text, remap
