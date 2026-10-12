"""Build a validated answer document from finalized Markdown and sources."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List

from . import citations as pp_citations
from . import markdown as pp_markdown


_IMAGE_FIELDS = ("id", "url", "caption", "figure", "hint", "source_label", "doc_id", "page")


def _split_markdown_blocks(markdown: str) -> List[str]:
    """Split top-level blocks without breaking blank lines inside code fences."""
    blocks: List[str] = []
    current: List[str] = []
    fence: str | None = None

    def flush() -> None:
        block = "\n".join(current).strip()
        current.clear()
        if block:
            blocks.append(block)

    for line in str(markdown or "").splitlines():
        stripped = line.lstrip()
        marker = "```" if stripped.startswith("```") else ("~~~" if stripped.startswith("~~~") else None)
        if marker:
            fence = None if fence == marker else (marker if fence is None else fence)
            current.append(line)
            continue
        if not line.strip() and fence is None:
            flush()
            continue
        current.append(line)

    flush()
    return blocks


def _valid_images(source: Dict[str, Any], label: str) -> Iterable[Dict[str, Any]]:
    for candidate in source.get("images") or []:
        if not isinstance(candidate, dict):
            continue
        image_id = str(candidate.get("id") or "").strip()
        url = str(candidate.get("url") or "").strip()
        owner = str(candidate.get("source_label") or "").strip()
        if not image_id or not url or owner != label:
            continue
        clean = {field: candidate.get(field) for field in _IMAGE_FIELDS if candidate.get(field) is not None}
        clean["id"] = image_id
        clean["url"] = url
        clean["caption"] = str(candidate.get("caption") or "参考配图").strip() or "参考配图"
        clean["source_label"] = label
        yield clean


def build_answer_document(answer: str, sources: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Bind source-owned images to the exact answer blocks citing that source."""
    source_by_label = {
        str(source.get("citation_label") or "").strip(): source
        for source in sources or []
        if str(source.get("citation_label") or "").strip()
    }
    source_order = list(source_by_label)
    emitted_image_ids: set[str] = set()
    sections: List[Dict[str, Any]] = []

    for index, block in enumerate(_split_markdown_blocks(answer), start=1):
        clean_block = pp_markdown.strip_markdown_images(block)
        cited = pp_citations.extract_citation_labels(clean_block)
        labels = [label for label in source_order if label in cited]
        images: List[Dict[str, Any]] = []
        for label in labels:
            for image in _valid_images(source_by_label[label], label):
                if image["id"] in emitted_image_ids:
                    continue
                emitted_image_ids.add(image["id"])
                images.append(image)
        sections.append(
            {
                "id": f"section-{index}",
                "markdown": clean_block,
                "source_labels": labels,
                "images": images,
            }
        )

    return {"sections": sections}
