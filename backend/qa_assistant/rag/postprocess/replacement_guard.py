"""
Guard for `answer_replaced` events.

Post-processing can accidentally degrade markdown that was already visible during
streaming (collapsing GFM tables, dropping images, flattening nested lists).  The
helpers here compare the streamed answer with its post-processed replacement and
veto the replacement when structure would be lost.
"""

import re
from typing import Dict, Optional, Tuple

_MARKDOWN_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$")
_MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*]\([^)]+\)")
_STRUCTURED_IMG_MARKER_RE = re.compile(r"\[\[\s*IMG\s*:\s*\d{1,2}-\d{1,2}(?:#\d{1,2})?\s*\]\]", re.IGNORECASE)


def inspect_markdown_shape(markdown: str) -> Dict[str, int]:
    """Measure structural features of a markdown answer (tables, images, list nesting)."""
    text = str(markdown or "")
    lines = text.split("\n")
    gfm_table_blocks = 0
    pipe_heavy_lines = 0
    nested_ordered_list_lines = 0
    nested_bullet_list_lines = 0

    for i, line in enumerate(lines):
        if line.count("|") >= 2:
            pipe_heavy_lines += 1
        header_like = bool(re.match(r"^\s*\|.+\|\s*$", line.strip()))
        sep_like = bool(
            _MARKDOWN_TABLE_SEPARATOR_RE.match((lines[i + 1] if i + 1 < len(lines) else "").strip())
        )
        if header_like and sep_like:
            gfm_table_blocks += 1

        if re.match(r"^\s{4,}\d+[.)]\s+\S+", line):
            nested_ordered_list_lines += 1
        if re.match(r"^\s{4,}[-*+]\s+\S+", line):
            nested_bullet_list_lines += 1

    return {
        "gfm_table_blocks": gfm_table_blocks,
        "pipe_heavy_lines": pipe_heavy_lines,
        "markdown_image_count": len(_MARKDOWN_IMAGE_RE.findall(text)),
        "structured_img_marker_count": len(_STRUCTURED_IMG_MARKER_RE.findall(text)),
        "length": len(text.strip()),
        "ordered_list_lines": len(re.findall(r"^\s{0,3}\d+[.)]\s+\S+", text, flags=re.MULTILINE)),
        "bullet_list_lines": len(re.findall(r"^\s{0,3}[-*+]\s+\S+", text, flags=re.MULTILINE)),
        "nested_ordered_list_lines": nested_ordered_list_lines,
        "nested_bullet_list_lines": nested_bullet_list_lines,
    }


def should_emit_answer_replacement(current: str, replacement: str) -> Tuple[bool, Optional[str]]:
    """Return (allowed, reject_reason) for replacing the streamed answer."""
    current_text = str(current or "")
    next_text = str(replacement or "")
    if not next_text.strip():
        return False, "empty-replacement"
    if not current_text.strip():
        return True, None

    cur = inspect_markdown_shape(current_text)
    nxt = inspect_markdown_shape(next_text)

    # Preserve streamed table layout: if the stream had GFM tables, don't let
    # post-processing collapse them away in the final replacement.
    if cur["gfm_table_blocks"] > 0 and nxt["gfm_table_blocks"] == 0:
        return False, "table-block-lost"

    # Preserve image-like anchors that were visible during streaming.
    cur_image_like = cur["markdown_image_count"] + cur["structured_img_marker_count"]
    nxt_image_like = nxt["markdown_image_count"] + nxt["structured_img_marker_count"]
    if cur_image_like > 0 and nxt_image_like == 0:
        return False, "image-lost"

    # Preserve visible ordered-list structure from streaming/finalized answer.
    if (
        cur["ordered_list_lines"] > 0
        and nxt["ordered_list_lines"] < cur["ordered_list_lines"]
        and nxt["bullet_list_lines"] > cur["bullet_list_lines"]
    ):
        return False, "ordered-list-lost"

    # Preserve nested list depth visible during streaming. Flattening nested
    # ordered/bullet children into top-level siblings causes the exact
    # "序号跳变 / 级别错乱 / 平级消融" behavior seen online.
    if (
        cur["nested_ordered_list_lines"] > 0
        and nxt["nested_ordered_list_lines"] < cur["nested_ordered_list_lines"]
    ):
        return False, "ordered-list-nesting-lost"
    if (
        cur["nested_bullet_list_lines"] > 0
        and nxt["nested_bullet_list_lines"] < cur["nested_bullet_list_lines"]
    ):
        return False, "bullet-list-nesting-lost"

    # Guard accidental truncation caused by downstream cleanup.
    if cur["length"] > 120 and nxt["length"] < int(cur["length"] * 0.55):
        return False, "severe-truncation"

    return True, None
