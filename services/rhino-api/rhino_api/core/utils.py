from __future__ import annotations

import logging
from typing import Iterable, Optional

import rhino3dm

logger = logging.getLogger(__name__)


def iter_user_strings(source: object) -> Iterable[tuple[str, Optional[str]]]:
    if source is None or not hasattr(source, "GetUserStrings"):
        return []
    try:
        entries = source.GetUserStrings()
    except Exception:
        return []

    if isinstance(entries, dict):
        return [(str(k), v if v is None else str(v)) for k, v in entries.items()]

    if isinstance(entries, (list, tuple)):
        pairs: list[tuple[str, Optional[str]]] = []
        for entry in entries:
            if isinstance(entry, (list, tuple)) and len(entry) == 2:
                pairs.append((str(entry[0]), entry[1] if entry[1] is None else str(entry[1])))
                continue
            key = getattr(entry, "Key", None)
            value = getattr(entry, "Value", None)
            if key is not None:
                pairs.append((str(key), value if value is None else str(value)))
        return pairs

    return []


def get_user_text_from_source(source: object, key: str) -> Optional[str]:
    if source is None:
        return None

    if hasattr(source, "GetUserString"):
        try:
            value = source.GetUserString(key)
        except Exception:
            value = None
        if isinstance(value, str) and value.strip():
            return value

    normalized_key = key.strip()
    if not normalized_key:
        return None

    normalized_lower = normalized_key.casefold()
    for entry_key, entry_value in iter_user_strings(source):
        candidate = entry_key.strip()
        if not candidate:
            continue
        if candidate == normalized_key or candidate.casefold() == normalized_lower:
            if isinstance(entry_value, str) and entry_value.strip():
                return entry_value

    return None


def get_user_text(obj: rhino3dm.File3dmObject, key: str) -> Optional[str]:
    try:
        normalized_key = key.strip()
        if not normalized_key:
            return None

        attributes = getattr(obj, "Attributes", None)
        value = get_user_text_from_source(attributes, normalized_key)
        if value:
            return value

        geometry = getattr(obj, "Geometry", None)
        return get_user_text_from_source(geometry, normalized_key)
    except Exception as exc:
        logger.warning("Failed to read UserText '%s': %s", key, exc)
        return None


def get_bounding_box(
    geometry: rhino3dm.CommonObject,
) -> Optional[rhino3dm.BoundingBox]:
    if not hasattr(geometry, "GetBoundingBox"):
        return None

    try:
        bbox = geometry.GetBoundingBox(True)
    except TypeError:
        try:
            bbox = geometry.GetBoundingBox()
        except Exception:
            return None

    if isinstance(bbox, tuple):
        bbox = bbox[0]

    if bbox is None or not bbox.IsValid:
        return None

    return bbox
