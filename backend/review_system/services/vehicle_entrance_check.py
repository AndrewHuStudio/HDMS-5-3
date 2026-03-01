"""
车行出入口与交叉口距离检测（纯 Python 实现）

检测每个车行出入口与主干路/次干路/支路交叉口的水平距离是否满足最小间距要求。
"""
from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import rhino3dm

from core.utils import get_bounding_box as _get_bounding_box
from core.utils import get_user_text as _get_user_text

logger = logging.getLogger(__name__)

Point3D = rhino3dm.Point3d


def _normalize_layer_name(name: str) -> str:
    """图层名称标准化：去首尾空格并转小写"""
    return name.strip().lower()


def _expand_layer_name(name: str) -> set[str]:
    """将图层名展开为候选集合，同时包含完整路径和末级名称"""
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
    """获取图层的所有候选名称，兼容 FullPath / Name 等不同属性名"""
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
    """从 File3dm 中按图层名加载所有对象，返回 (对象, 几何体) 列表"""
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


def _geometry_to_point(geometry: rhino3dm.CommonObject) -> Optional[Point3D]:
    """从几何体中提取代表点，Point 取位置，其他类型取 BoundingBox 中心"""
    if isinstance(geometry, rhino3dm.Point):
        return geometry.Location
    if isinstance(geometry, rhino3dm.Point3d):
        return geometry
    if isinstance(geometry, rhino3dm.PointCloud):
        try:
            if geometry.Count > 0:
                return geometry[0]
        except Exception:
            pass
    bbox = _get_bounding_box(geometry)
    if bbox is None:
        return None
    return bbox.Center


def _distance_xy(a: Point3D, b: Point3D) -> float:
    """计算两点在 XY 平面上的水平距离"""
    return math.hypot(a.X - b.X, a.Y - b.Y)


def _min_distance_xy(point: Point3D, points: List[Point3D]) -> Optional[float]:
    """计算点到点集中最近点的水平距离，点集为空时返回 None"""
    if not points:
        return None
    best = None
    for target in points:
        dist = _distance_xy(point, target)
        if best is None or dist < best:
            best = dist
    return best


def _resolve_object_name(obj: rhino3dm.File3dmObject, fallback: str) -> str:
    """从对象 UserText 或 Attributes 中读取名称，找不到时返回 fallback"""
    name = _get_user_text(obj, "地块名称") or _get_user_text(obj, "名称")
    if name:
        return name
    attributes = getattr(obj, "Attributes", None)
    if attributes:
        for attr_name in ("Name", "name", "ObjectName", "objectName"):
            value = getattr(attributes, attr_name, None)
            if callable(value):
                try:
                    value = value()
                except TypeError:
                    value = None
            if isinstance(value, str) and value.strip():
                return value.strip()
    return fallback


def _candidate_plot_layers(file3dm: rhino3dm.File3dm, preferred_layer: str) -> List[str]:
    """返回地块图层候选列表：优先传入图层，其次自动发现包含“地块”的图层"""
    candidates: List[str] = []
    if preferred_layer and preferred_layer.strip():
        candidates.append(preferred_layer)

    seen = {_normalize_layer_name(name) for name in candidates}
    for layer in file3dm.Layers:
        for name in _layer_name_candidates(layer):
            if "地块" not in name:
                continue
            normalized = _normalize_layer_name(name)
            if normalized in seen:
                continue
            seen.add(normalized)
            candidates.append(name)
            break
    return candidates


def _resolve_plot_name(obj: rhino3dm.File3dmObject, fallback: str) -> str:
    """从对象 UserText 或 Attributes 中读取地块名称，找不到时返回 fallback"""
    name = (
        _get_user_text(obj, "地块名称")
        or _get_user_text(obj, "地块")
        or _get_user_text(obj, "名称")
    )
    if name:
        return name
    return _resolve_object_name(obj, fallback)


def _point_in_bbox_xy(point: Point3D, bbox: rhino3dm.BoundingBox, tol: float = 0.0) -> bool:
    """判断点在 XY 平面上是否位于 BoundingBox 内（含容差）"""
    return (
        (bbox.Min.X - tol) <= point.X <= (bbox.Max.X + tol)
        and (bbox.Min.Y - tol) <= point.Y <= (bbox.Max.Y + tol)
    )


def _match_plot_name_by_point(
    point: Point3D, plot_entries: List[Dict[str, object]], tol: float = 0.0
) -> Optional[str]:
    """根据点坐标匹配所属地块：优先 bbox 包含，失败时回退最近地块中心"""
    for entry in plot_entries:
        bbox = entry.get("bbox")
        if isinstance(bbox, rhino3dm.BoundingBox) and _point_in_bbox_xy(point, bbox, tol):
            return str(entry["name"])

    best_name: Optional[str] = None
    best_dist = float("inf")
    for entry in plot_entries:
        center = entry.get("center")
        if not isinstance(center, rhino3dm.Point3d):
            continue
        dist = math.hypot(point.X - center.X, point.Y - center.Y)
        if dist < best_dist:
            best_dist = dist
            best_name = str(entry["name"])
    return best_name


def check_vehicle_entrance_distance(
    *,
    model_path: Path,
    entrance_layer: str = "场地_车行出入口",
    main_intersection_layer: str = "场地_主干路交叉口",
    secondary_intersection_layer: str = "场地_次干路交叉口",
    branch_intersection_layer: str = "场地_支路交叉口",
    plot_layer: str = "场景_地块",
    min_main_distance: float = 100.0,
    min_secondary_distance: float = 80.0,
    min_branch_distance: float = 50.0,
) -> Dict:
    """
    车行出入口与交叉口距离检测主函数。
    对每个车行出入口点，分别计算其与主干路/次干路/支路交叉口的最小水平距离，
    若小于对应最小间距要求则标记为不合规。
    交叉口图层为空时默认该项通过并记录警告。
    """
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Failed to read 3dm file: {model_path}")

    entrance_objects = _load_objects_from_layer(file3dm, entrance_layer)
    if not entrance_objects:
        raise ValueError(f"No vehicle entrance points found in layer: {entrance_layer}")

    main_objects = _load_objects_from_layer(file3dm, main_intersection_layer)
    secondary_objects = _load_objects_from_layer(file3dm, secondary_intersection_layer)
    branch_objects = _load_objects_from_layer(file3dm, branch_intersection_layer)

    main_points = [pt for _, geom in main_objects if (pt := _geometry_to_point(geom))]
    secondary_points = [pt for _, geom in secondary_objects if (pt := _geometry_to_point(geom))]
    branch_points = [pt for _, geom in branch_objects if (pt := _geometry_to_point(geom))]
    detected_plot_layer = plot_layer
    plot_objects: List[Tuple[rhino3dm.File3dmObject, rhino3dm.CommonObject]] = []
    for candidate in _candidate_plot_layers(file3dm, plot_layer):
        objs = _load_objects_from_layer(file3dm, candidate)
        if objs:
            plot_objects = objs
            detected_plot_layer = candidate
            break

    plot_entries: List[Dict[str, object]] = []
    for plot_index, (plot_obj, plot_geometry) in enumerate(plot_objects):
        bbox = _get_bounding_box(plot_geometry)
        if bbox is None:
            continue
        plot_entries.append(
            {
                "name": _resolve_plot_name(plot_obj, f"地块{plot_index + 1}"),
                "bbox": bbox,
                "center": bbox.Center,
            }
        )

    warnings: List[str] = []
    if not main_points:
        warnings.append("未找到主干路交叉口，已默认通过该项")
    if not secondary_points:
        warnings.append("未找到次干路交叉口，已默认通过该项")
    if not branch_points:
        warnings.append("未找到支路交叉口，已默认通过该项")
    if not plot_entries:
        warnings.append("未找到地块图层或无有效地块边界，出入口无法映射地块名称")

    results = []
    passed = 0
    failed = 0

    for idx, (obj, geometry) in enumerate(entrance_objects):
        point = _geometry_to_point(geometry)
        if point is None:
            continue

        object_id = getattr(getattr(obj, "Attributes", None), "Id", None)
        name = _resolve_object_name(obj, f"出入口{idx + 1}")

        main_dist = _min_distance_xy(point, main_points)
        secondary_dist = _min_distance_xy(point, secondary_points)
        branch_dist = _min_distance_xy(point, branch_points)

        reasons: List[str] = []
        if main_dist is not None and main_dist < min_main_distance:
            reasons.append("too_close_main_intersection")
        if secondary_dist is not None and secondary_dist < min_secondary_distance:
            reasons.append("too_close_secondary_intersection")
        if branch_dist is not None and branch_dist < min_branch_distance:
            reasons.append("too_close_branch_intersection")

        status = "fail" if reasons else "pass"
        if status == "pass":
            passed += 1
        else:
            failed += 1

        results.append(
            {
                "index": idx,
                "name": name,
                "object_id": str(object_id) if object_id else None,
                "point": [float(point.X), float(point.Y), float(point.Z)],
                "plot_name": _match_plot_name_by_point(point, plot_entries, 0.0),
                "status": status,
                "reasons": reasons,
                "distances": {
                    "main": main_dist,
                    "secondary": secondary_dist,
                    "branch": branch_dist,
                },
            }
        )

    return {
        "status": "ok",
        "summary": {
            "total": len(results),
            "passed": passed,
            "failed": failed,
        },
        "results": results,
        "warnings": warnings,
        "parameters": {
            "entrance_layer": entrance_layer,
            "main_intersection_layer": main_intersection_layer,
            "secondary_intersection_layer": secondary_intersection_layer,
            "branch_intersection_layer": branch_intersection_layer,
            "plot_layer": detected_plot_layer,
            "min_main_distance": min_main_distance,
            "min_secondary_distance": min_secondary_distance,
            "min_branch_distance": min_branch_distance,
        },
    }
