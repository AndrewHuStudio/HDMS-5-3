"""Structured image evidence shared by source and answer payloads."""

from __future__ import annotations

from hashlib import sha256
from typing import Any, Dict, List, Optional


def stable_image_id(doc_id: str, url: str) -> str:
    """Return a stable opaque ID for one document image."""
    identity = f"{str(doc_id or '').strip()}\n{str(url or '').strip()}"
    return f"img-{sha256(identity.encode('utf-8')).hexdigest()[:20]}"


def build_image_evidence_records(
    *,
    urls: List[str],
    hints: List[str],
    figures: List[str],
    captions: List[str],
    source_label: str,
    doc_id: Optional[str],
    page: Optional[int],
) -> List[Dict[str, Any]]:
    """Build aligned, validated records without exposing opaque filenames."""
    records: List[Dict[str, Any]] = []
    normalized_doc_id = str(doc_id or "").strip()

    for index, raw_url in enumerate(urls or []):
        url = str(raw_url or "").strip()
        if not url:
            continue

        hint = str(hints[index] if index < len(hints) else "").strip()
        figure = str(figures[index] if index < len(figures) else "").strip()
        caption = str(captions[index] if index < len(captions) else "").strip()
        display_caption = hint or caption or figure or f"图片{index + 1}"

        records.append(
            {
                "id": stable_image_id(normalized_doc_id, url),
                "url": url,
                "caption": display_caption,
                "figure": figure or None,
                "hint": hint or display_caption,
                "source_label": source_label,
                "doc_id": normalized_doc_id or None,
                "page": page,
            }
        )

    return records
