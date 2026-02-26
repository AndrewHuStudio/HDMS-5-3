"""
Rhino 对象工具函数
提供从 rhino3dm 对象中读取 UserText 和 BoundingBox 的通用方法，
兼容不同版本的 rhino3dm API 属性名差异。
"""
from __future__ import annotations

from typing import Any


def _get_user_string(source: Any, key: str) -> str | None:
    """
    从对象或其属性中读取指定 key 的 UserText 字符串。
    兼容 GetUserString / GetUserText / UserStrings 等不同接口。
    """
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
    """
    从 rhino3dm 对象中读取 UserText，先查对象本身，再查 Attributes。
    """
    value = _get_user_string(obj, key)
    if value:
        return value
    attributes = getattr(obj, "Attributes", None)
    return _get_user_string(attributes, key)


def get_user_text_from_source(source: Any, key: str) -> str | None:
    """直接从指定来源（如图层对象）读取 UserText"""
    return _get_user_string(source, key)


def get_bounding_box(geometry: Any):
    """
    获取几何体的 BoundingBox，兼容 GetBoundingBox() 方法和 BoundingBox 属性。
    返回 None 表示几何体无效或无法计算包围盒。
    """
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
