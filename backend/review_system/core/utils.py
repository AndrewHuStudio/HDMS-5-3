from __future__ import annotations

from typing import Any


def _get_user_string(source: Any, key: str) -> str | None:
    if source is None:
        return None
    for attr in ("GetUserString", "GetUserText", "get_user_string"):
        method = getattr(source, attr, None)
        if callable(method):
            try:
                value = method(key)
            except TypeError:
                continue
            if isinstance(value, str) and value.strip():
                return value.strip()
    user_strings = getattr(source, "UserStrings", None)
    if isinstance(user_strings, dict):
        value = user_strings.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def get_user_text(obj: Any, key: str) -> str | None:
    value = _get_user_string(obj, key)
    if value:
        return value
    attributes = getattr(obj, "Attributes", None)
    return _get_user_string(attributes, key)


def get_user_text_from_source(source: Any, key: str) -> str | None:
    return _get_user_string(source, key)


def get_bounding_box(geometry: Any):
    if geometry is None:
        return None

    method = getattr(geometry, "GetBoundingBox", None)
    if callable(method):
        try:
            bbox = method(True)
        except TypeError:
            try:
                bbox = method()
            except Exception:
                bbox = None
        except Exception:
            bbox = None
        if bbox is not None:
            is_valid = getattr(bbox, "IsValid", None)
            if callable(is_valid):
                try:
                    if not is_valid():
                        return None
                except Exception:
                    pass
            return bbox

    bbox = getattr(geometry, "BoundingBox", None)
    if bbox is not None:
        is_valid = getattr(bbox, "IsValid", None)
        if callable(is_valid):
            try:
                if not is_valid():
                    return None
            except Exception:
                pass
        return bbox

    return None
