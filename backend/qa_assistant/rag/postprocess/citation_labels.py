"""
Citation label remapping for source lists.

`normalize_citations` renumbers the [N-M] markers that actually appear in the
answer, and returns a *partial* remap covering only those cited labels.
Applying that partial map directly to the source list is unsafe: an uncited
source keeps its original label, which can collide with the new label of a
cited source.

Example — sources 1-1, 1-2, 1-3, answer cites only 1-2 and 1-3:
    remap = {"1-2": "1-1", "1-3": "1-2"}
    naive apply -> labels ["1-1", "1-1", "1-2"]   # 1-1 duplicated, 1-3 gone

Duplicate labels break the strict answer-marker <-> source-card correspondence:
the frontend merges same-label entries into a single card (merging page numbers
via min()), so a citation silently disappears and its "open PDF" action lands on
the wrong page.

This module completes the remap so the whole label space stays a bijection:
cited sources take the labels used in the answer, and uncited sources are pushed
onto the next free per-document index.
"""

from typing import Any, Dict, List, Optional, Tuple


def _split_label(label: str) -> Optional[Tuple[str, int]]:
    """Split a document label "N-M" into (doc, chunk index). None if not that shape."""
    if "-" not in label:
        # Graph sources use a plain "N" label and are never remapped.
        return None
    doc, _, chunk = label.partition("-")
    if not doc.isdigit() or not chunk.isdigit():
        return None
    return doc, int(chunk)


def build_complete_label_remap(
    sources: List[Dict[str, Any]],
    remap: Dict[str, str],
) -> Dict[str, str]:
    """
    Extend a partial old->new label remap so it covers every document source.

    Cited labels keep the mapping chosen while normalizing the answer. Uncited
    labels are reassigned to the lowest per-document index not claimed by a
    cited label, which guarantees the resulting labels are unique.
    """
    if not sources:
        return dict(remap)

    complete: Dict[str, str] = {}
    # Per document: indices already claimed by cited (remapped) labels.
    claimed: Dict[str, set] = {}
    pending: List[Tuple[str, str]] = []  # (original label, doc)

    for src in sources:
        label = str(src.get("citation_label") or "").strip()
        parts = _split_label(label)
        if parts is None:
            continue
        doc = parts[0]
        claimed.setdefault(doc, set())

        new_label = remap.get(label)
        if new_label is None:
            pending.append((label, doc))
            continue

        complete[label] = new_label
        new_parts = _split_label(new_label)
        if new_parts is not None:
            claimed[new_parts[0]].add(new_parts[1])

    # Assign uncited labels to the next free index, preserving their relative order.
    next_free: Dict[str, int] = {}
    for label, doc in pending:
        taken = claimed[doc]
        candidate = next_free.get(doc, 1)
        while candidate in taken:
            candidate += 1
        taken.add(candidate)
        next_free[doc] = candidate + 1
        complete[label] = f"{doc}-{candidate}"

    return complete


def apply_citation_remap_to_sources(
    sources: List[Dict[str, Any]],
    remap: Dict[str, str],
) -> None:
    """
    Relabel sources in place using a remap completed by `build_complete_label_remap`.

    New labels are computed for every source before any is written back, so a
    source is never relabelled using another source's freshly assigned value.
    """
    if not sources:
        return

    complete = build_complete_label_remap(sources, remap or {})
    if not complete:
        return

    resolved = [
        complete.get(str(src.get("citation_label") or "").strip())
        for src in sources
    ]
    for src, new_label in zip(sources, resolved):
        if new_label:
            src["citation_label"] = new_label
