from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import rhino3dm

from core.utils import get_bounding_box as _get_bounding_box

logger = logging.getLogger(__name__)

Point2D = Tuple[float, float]


def _normalize_layer_name(name: str) -> str:
    return name.strip().lower()


def _expand_layer_name(name: str) -> set[str]:
    normalized = _normalize_layer_name(name)
    if not normalized:
        return set()
    expanded = {normalized}
    if "::" in name:
        parts = [part.strip() for part in name.split("::") if part.strip()]
        if parts:
            expanded.add(_normalize_layer_name(parts[-1]))
    return expanded


def _layer_name_candidates(layer: rhino3dm.Layer) -> List[str]:
    names: List[str] = []
    for attr in ("FullPath", "fullPath", "Name", "name"):
        value = getattr(layer, attr, None)
        if callable(value):
            try:
                value = value()
            except TypeError:
                value = None
        if isinstance(value, str) and value.strip():
            names.append(value)
    return names


def _load_objects_from_layer(
    file3dm: rhino3dm.File3dm, layer_name: str
) -> List[Tuple[rhino3dm.File3dmObject, rhino3dm.CommonObject]]:
    target_layers = _expand_layer_name(layer_name)
    if not target_layers:
        return []

    layer_by_index: Dict[int, set[str]] = {}
    for i, layer in enumerate(file3dm.Layers):
        layer_index = getattr(layer, "Index", None) or getattr(layer, "index", None) or i
        names = _layer_name_candidates(layer)
        if not names:
            continue
        normalized: set[str] = set()
        for name in names:
            normalized.update(_expand_layer_name(name))
        if normalized:
            layer_by_index[layer_index] = normalized

    objects = []
    for obj in file3dm.Objects:
        geometry = obj.Geometry
        if geometry is None:
            continue
        attributes = getattr(obj, "Attributes", None)
        layer_index = getattr(attributes, "LayerIndex", None) if attributes else None
        if layer_index is None:
            continue
        obj_layers = layer_by_index.get(layer_index, set())
        if obj_layers & target_layers:
            objects.append((obj, geometry))
    return objects


def _get_object_id(obj: rhino3dm.File3dmObject) -> Optional[str]:
    attributes = getattr(obj, "Attributes", None)
    if attributes is None:
        return None
    obj_id = getattr(attributes, "Id", None)
    return str(obj_id) if obj_id else None


def _get_centroid_2d(bbox: rhino3dm.BoundingBox) -> Point2D:
    min_pt = bbox.Min
    max_pt = bbox.Max
    return ((min_pt.X + max_pt.X) / 2, (min_pt.Y + max_pt.Y) / 2)


def _get_bbox_dimensions(bbox: rhino3dm.BoundingBox) -> Tuple[float, float, float]:
    min_pt = bbox.Min
    max_pt = bbox.Max
    return (
        abs(max_pt.X - min_pt.X),
        abs(max_pt.Y - min_pt.Y),
        abs(max_pt.Z - min_pt.Z),
    )


def _point_in_bbox_2d(point: Point2D, bbox: rhino3dm.BoundingBox, tolerance: float = 0.1) -> bool:
    min_pt = bbox.Min
    max_pt = bbox.Max
    return (
        min_pt.X - tolerance <= point[0] <= max_pt.X + tolerance
        and min_pt.Y - tolerance <= point[1] <= max_pt.Y + tolerance
    )


def _get_plot_name(obj: rhino3dm.File3dmObject) -> str:
    attributes = getattr(obj, "Attributes", None)
    if attributes:
        name = getattr(attributes, "Name", None)
        if name and isinstance(name, str) and name.strip():
            return name.strip()
    return "unknown_plot"


def check_sky_bridge_pure_python(
    *,
    model_path: Path,
    corridor_layer: str = "模型_空中连廊",
    plot_layer: str = "场景_地块",
    min_width: float = 4.0,
    min_height: float = 2.2,
    min_clearance: float = 5.0,
) -> Dict:
    """
    空中连廊检测：检查连廊是否跨越两个地块，以及尺寸是否满足规范要求。

    参数:
        model_path: 3dm 模型文件路径
        corridor_layer: 空中连廊图层名称
        plot_layer: 地块图层名称
        min_width: 最小净宽 (m)
        min_height: 最小净高 (m)
        min_clearance: 最小离地净空 (m)
    """
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Cannot read 3dm file: {model_path}")

    warnings: List[str] = []

    # 加载地块和连廊对象
    plot_objects = _load_objects_from_layer(file3dm, plot_layer)
    corridor_objects = _load_objects_from_layer(file3dm, corridor_layer)

    if not plot_objects:
        warnings.append(f"未找到地块图层 '{plot_layer}' 中的对象")
        return {
            "status": "ok",
            "method": "pure_python",
            "summary": {"total_connections": 0, "passed": 0, "failed": 0},
            "results": [],
            "warnings": warnings,
            "parameters": {
                "corridor_layer": corridor_layer,
                "plot_layer": plot_layer,
                "min_width": min_width,
                "min_height": min_height,
                "min_clearance": min_clearance,
            },
        }

    if not corridor_objects:
        warnings.append(f"未找到空中连廊图层 '{corridor_layer}' 中的对象")
        return {
            "status": "ok",
            "method": "pure_python",
            "summary": {"total_connections": 0, "passed": 0, "failed": 0},
            "results": [],
            "warnings": [f"未找到空中连廊图层 '{corridor_layer}' 中的对象"],
            "parameters": {
                "corridor_layer": corridor_layer,
                "plot_layer": plot_layer,
                "min_width": min_width,
                "min_height": min_height,
                "min_clearance": min_clearance,
            },
        }

    # 构建地块信息
    plots: List[Dict] = []
    for obj, geometry in plot_objects:
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            continue
        plots.append({
            "name": _get_plot_name(obj),
            "bbox": bbox,
            "centroid": _get_centroid_2d(bbox),
        })

    # 检测每个连廊
    results: List[Dict] = []
    connection_index = 0

    for obj, geometry in corridor_objects:
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            continue

        corridor_centroid = _get_centroid_2d(bbox)
        width, depth, height = _get_bbox_dimensions(bbox)
        corridor_width = min(width, depth)
        corridor_height = height
        corridor_clearance = bbox.Min.Z
        object_id = _get_object_id(obj)

        # 判断连廊跨越了哪些地块
        connected_plots: List[str] = []
        for plot in plots:
            if _point_in_bbox_2d(corridor_centroid, plot["bbox"], tolerance=max(width, depth) / 2):
                connected_plots.append(plot["name"])

        # 如果没有找到跨越的地块，尝试用连廊两端判断
        if len(connected_plots) < 2:
            min_pt = bbox.Min
            max_pt = bbox.Max
            endpoints = [
                (min_pt.X, min_pt.Y),
                (max_pt.X, max_pt.Y),
                (min_pt.X, max_pt.Y),
                (max_pt.X, min_pt.Y),
            ]
            for plot in plots:
                if plot["name"] in connected_plots:
                    continue
                for ep in endpoints:
                    if _point_in_bbox_2d(ep, plot["bbox"], tolerance=1.0):
                        connected_plots.append(plot["name"])
                        break

        # 去重
        connected_plots = list(dict.fromkeys(connected_plots))

        # 判断状态和原因
        reasons: List[str] = []
        if len(connected_plots) < 2:
            reasons.append("not_connecting")
        if corridor_width < min_width:
            reasons.append("width_too_small")
        if corridor_height < min_height:
            reasons.append("height_too_small")
        if corridor_clearance < min_clearance:
            reasons.append("clearance_too_low")

        status = "pass" if len(reasons) == 0 else "fail"
        plot_a = connected_plots[0] if len(connected_plots) > 0 else "unknown"
        plot_b = connected_plots[1] if len(connected_plots) > 1 else "unknown"

        label_position = [
            corridor_centroid[0],
            corridor_centroid[1],
            (bbox.Min.Z + bbox.Max.Z) / 2,
        ]

        results.append({
            "connection_id": f"conn_{connection_index}",
            "plot_a": plot_a,
            "plot_b": plot_b,
            "status": status,
            "reasons": reasons,
            "label_position": label_position,
            "corridors": [
                {
                    "index": 0,
                    "width": round(corridor_width, 2),
                    "height": round(corridor_height, 2),
                    "clearance": round(corridor_clearance, 2),
                    "is_closed": True,
                    "status": status,
                    "object_id": object_id,
                    "outline_points": [
                        [bbox.Min.X, bbox.Min.Y, bbox.Min.Z],
                        [bbox.Max.X, bbox.Min.Y, bbox.Min.Z],
                        [bbox.Max.X, bbox.Max.Y, bbox.Min.Z],
                        [bbox.Min.X, bbox.Max.Y, bbox.Min.Z],
                    ],
                }
            ],
        })
        connection_index += 1

    passed = sum(1 for r in results if r["status"] == "pass")
    failed = sum(1 for r in results if r["status"] == "fail")

    return {
        "status": "ok",
        "method": "pure_python",
        "summary": {
            "total_connections": len(results),
            "passed": passed,
            "failed": failed,
        },
        "results": results,
        "warnings": warnings,
        "parameters": {
            "corridor_layer": corridor_layer,
            "plot_layer": plot_layer,
            "min_width": min_width,
            "min_height": min_height,
            "min_clearance": min_clearance,
        },
    }
