import re
from typing import Dict, List, Optional, Tuple


# Matches a single [N-M] marker.
_SINGLE_CITE_RE = re.compile(r"\[(\d+)-(\d+)\]")


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

    # Clean up whitespace left by removed citations.
    result = re.sub(r"[ \t]{2,}", " ", result)
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
