import re
from typing import Dict, List, Optional, Tuple


# Matches a single [N-M] marker.
_SINGLE_CITE_RE = re.compile(r"\[(\d+)-(\d+)\]")
_PAREN_CITE_RE = re.compile(r"[（(]\s*(\d{1,2}-\d{1,2})\s*[)）]")
_STANDALONE_CITE_RE = re.compile(
    r"(^|[\s，。！？；：,.!?;:、（）()【】《》<>“”\"'])"
    r"(\d{1,2}-\d{1,2})"
    r"(?=$|[\s，。！？；：,.!?;:、（）()【】《》<>“”\"'])",
    flags=re.MULTILINE,
)


def _collapse_extra_spaces_preserving_indent(text: str) -> str:
    """Collapse repeated intra-line spaces without stripping leading indent."""
    if not text:
        return text

    normalized_lines: List[str] = []
    for line in text.splitlines():
        indent_match = re.match(r"^([ \t]*)(.*)$", line)
        if not indent_match:
            normalized_lines.append(line)
            continue

        indent = indent_match.group(1) or ""
        rest = indent_match.group(2) or ""
        rest = re.sub(r"[ \t]{2,}", " ", rest).rstrip()
        normalized_lines.append(f"{indent}{rest}")

    return "\n".join(normalized_lines)


def _normalize_loose_citation_labels(text: str, valid_labels: Optional[set]) -> str:
    """
    Normalize loose citation labels into canonical [N-M] markers.

    Supported loose forms:
    - （2-3） / (2-3)
    - standalone 2-3 surrounded by punctuation/whitespace

    Only labels present in valid_labels are normalized to avoid false positives.
    """
    if not text or not valid_labels:
        return text

    def _replace_paren(match: re.Match) -> str:
        label = str(match.group(1) or "").strip()
        if label in valid_labels:
            return f"[{label}]"
        return match.group(0)

    normalized = _PAREN_CITE_RE.sub(_replace_paren, text)

    def _replace_standalone(match: re.Match) -> str:
        prefix = match.group(1) or ""
        label = str(match.group(2) or "").strip()
        if label in valid_labels:
            return f"{prefix}[{label}]"
        return match.group(0)

    return _STANDALONE_CITE_RE.sub(_replace_standalone, normalized)


def normalize_citations(text: str, valid_labels: Optional[set] = None) -> Tuple[str, Dict[str, str]]:
    """Normalize citation markers like [N-M] in answer text.

    Rules applied:
    1) Collapse stacked citations (e.g. [2-1][2-4][1-1]) by keeping at most one
       marker per document (N) within the stacked group, preserving cross-document citations.
    2) Preserve the document index N (do not renumber it).
    3) Remap chunk index M per document by order of first appearance: [N-*] -> [N-1], [N-2], ...
    4) Keep each resulting citation marker at most once in the whole answer.
    5) Optionally filter out citations not present in valid_labels.

    Returns: (processed_text, remap_dict) where remap_dict maps old_label -> new_label.
    """
    if not text:
        return text, {}

    text = _normalize_loose_citation_labels(text, valid_labels)

    # Step 1: Collapse stacked citations — keep at most one valid marker per-doc within a stacked group.
    def _collapse_stacked(match: re.Match) -> str:
        labels_in_group = _SINGLE_CITE_RE.findall(match.group(0))
        kept: List[str] = []
        seen_docs: set[str] = set()
        for n, m in labels_in_group:
            doc = str(n)
            if doc in seen_docs:
                continue
            label = f"{n}-{m}"
            if valid_labels is not None and label not in valid_labels:
                continue
            seen_docs.add(doc)
            kept.append(label)

        if kept:
            return "".join(f"[{lab}]" for lab in kept)

        # No valid label in this stacked group.
        if valid_labels is not None:
            return ""
        if labels_in_group:
            return f"[{labels_in_group[0][0]}-{labels_in_group[0][1]}]"
        return match.group(0)

    stacked_re = re.compile(r"\[\d+-\d+\](?:\s*\[\d+-\d+\])+")
    collapsed = stacked_re.sub(_collapse_stacked, text)

    # Step 2: Remap. Preserve N; assign M per-doc by first appearance order.
    remap: Dict[str, str] = {}
    per_doc_counter: Dict[str, int] = {}

    def _remap_single(match: re.Match) -> str:
        old_label = f"{match.group(1)}-{match.group(2)}"
        if valid_labels is not None and old_label not in valid_labels:
            return ""

        new_label = remap.get(old_label)
        if new_label is None:
            doc = match.group(1)
            per_doc_counter[doc] = per_doc_counter.get(doc, 0) + 1
            new_label = f"{doc}-{per_doc_counter[doc]}"
            remap[old_label] = new_label

        return f"[{new_label}]"

    result = _SINGLE_CITE_RE.sub(_remap_single, collapsed)

    # Collapse immediate duplicates like "[1-1][1-1]" or "[1-1] [1-1]".
    result = re.sub(r"(\[\d+-\d+\])(?:\s*\1)+", r"\1", result)

    # Clean up whitespace left by removed citations while preserving leading
    # indentation, which is structurally significant for nested markdown lists.
    result = _collapse_extra_spaces_preserving_indent(result)
    # Strip trailing horizontal whitespace before newlines, but preserve blank
    # lines (consecutive \n) which are structurally significant in markdown.
    result = re.sub(r"[ \t]+\n", "\n", result)

    return result, remap


def extract_citation_labels(text: str) -> set:
    """Extract normalized N-M labels from answer text."""
    labels = set()
    for m in _SINGLE_CITE_RE.finditer(text or ""):
        labels.add(f"{m.group(1)}-{m.group(2)}")
    return labels
