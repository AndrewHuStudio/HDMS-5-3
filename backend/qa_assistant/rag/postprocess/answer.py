import re
from typing import Dict, Optional, Tuple

from . import citations as pp_citations
from . import markdown as pp_markdown
from . import math as pp_math
from . import images as pp_images


# Match "## 检索综述" with optional trailing colon variants.
_RETRIEVAL_OVERVIEW_HEADING_RE = re.compile(r"^##\s+检索综述\s*[:：]?\s*$")
_H2_HEADING_RE = re.compile(r"^##\s+\S")


def dedupe_retrieval_overview_heading(text: str) -> str:
    """Keep only the first ``## 检索综述`` section; remove duplicate blocks.

    The backend injects this heading as a prefix, but the LLM may regenerate
    it in the body.  This idempotent guard ensures at most one retrieval
    overview block remains and prevents duplicate body lines from leaking into
    the next section.
    """
    if not text:
        return text
    lines = text.splitlines()
    seen_first = False
    changed = False
    out: list[str] = []

    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        if not _RETRIEVAL_OVERVIEW_HEADING_RE.match(stripped):
            out.append(lines[i])
            i += 1
            continue

        if not seen_first:
            seen_first = True
            out.append(lines[i])
            i += 1
            continue

        # Drop duplicate retrieval overview section as a whole (heading + body
        # until next level-2 heading) to avoid leaking overview lines into
        # "相关概念" after heading-only dedupe.
        changed = True
        i += 1
        while i < len(lines) and not _H2_HEADING_RE.match(lines[i].strip()):
            i += 1

        # Keep section boundaries tidy after block removal.
        while out and not out[-1].strip():
            out.pop()
        if i < len(lines) and out and out[-1].strip():
            out.append("")

    if not changed:
        return text
    while out and not out[-1].strip():
        out.pop()
    return "\n".join(out)


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
      - _SECTION_PAREN_RE / _CITE_WITH_SECTION_RE cleanup (data noise)
      - normalize_image_reference_markers (structured [[IMG:N-M]] protocol)
      - unescape_dollar_delimiters        (LLM output \\$ fix)
      - normalize_citations               (chunk_id remap)
    """
    # Data-layer structural cleanup (no rendering changes).
    text = pp_markdown.sanitize_answer_data_only(text)
    # Idempotent guard: keep only the first "## 检索综述" heading.
    text = dedupe_retrieval_overview_heading(text)
    # Structured image markers (frontend depends on this protocol).
    text = pp_images.normalize_image_reference_markers(text, valid_labels)
    # Fix escaped dollar delimiters from LLM output.
    text = pp_math.unescape_dollar_delimiters(text)
    # Citation dedup and index remap (needs chunk_id mapping).
    text, remap = pp_citations.normalize_citations(text, valid_labels)
    return text, remap
