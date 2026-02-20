from typing import Any, Dict, List, Set


def filter_sources_to_referenced(
    sources: List[Dict[str, Any]],
    *,
    referenced_labels: Set[str],
    keep_image_sources: bool = False,
    keep_uncited_document_sources: bool = False,
    max_extra_image_sources: int = 3,
) -> List[Dict[str, Any]]:
    """Keep only sources that are cited by normalized [N-M] labels."""
    if not sources:
        return sources
    if not referenced_labels:
        return sources

    filtered: List[Dict[str, Any]] = []
    kept_extra_artifacts = 0
    for src in sources:
        label = (src.get("citation_label") or "").strip()
        if not label:
            continue
        if "-" in label:
            if label in referenced_labels:
                filtered.append(src)
            elif keep_uncited_document_sources:
                filtered.append(src)
            elif keep_image_sources and kept_extra_artifacts < max_extra_image_sources:
                has_images = bool(src.get("image_urls") or src.get("image_url"))
                has_tables = bool(src.get("table_markdown") or src.get("has_table"))
                if has_images or has_tables:
                    filtered.append(src)
                    kept_extra_artifacts += 1
        else:
            filtered.append(src)
    return filtered
