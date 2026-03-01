"""
人行出入口数量检测（纯 Python 实现）

检测每条建筑红线范围内的人行出入口数量是否满足最低要求（默认 >= 2 个）。
出入口点需在红线曲线内部或边界容差范围内才计入。
"""
from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import rhino3dm

from core.utils import get_bounding_box as _get_bounding_box
from core.utils import get_user_text as _get_user_text

logger = logging.getLogger(__name__)

Point3D = rhino3dm.Point3d
Point2D = Tuple[float, float]
Segment2D = Tuple[Point2D, Point2D]
MIN_REQUIRED_PEDESTRIAN_ENTRANCES = 2


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
    """从几何体中提取点坐标，支持 Point / Point3d / PointCloud，失败时返回 BoundingBox 中心"""
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


def _points_are_close(a: rhino3dm.Point3d, b: rhino3dm.Point3d, tol: float = 1e-6) -> bool:
    """判断两点是否在容差范围内重合"""
    return (
        math.isclose(a.X, b.X, abs_tol=tol)
        and math.isclose(a.Y, b.Y, abs_tol=tol)
        and math.isclose(a.Z, b.Z, abs_tol=tol)
    )


def _curve_to_points(curve: rhino3dm.Curve, sample_count: int = 120) -> List[rhino3dm.Point3d]:
    """将曲线转换为点列表，优先取多段线顶点，否则均匀采样"""
    if hasattr(curve, "TryGetPolyline"):
        try:
            polyline = curve.TryGetPolyline()
        except Exception:
            polyline = None
        if polyline:
            points = [polyline[i] for i in range(polyline.Count)]
            if len(points) > 1 and _points_are_close(points[0], points[-1]):
                points = points[:-1]
            return points

    try:
        domain = curve.Domain
        t_start = domain.T0
        t_end = domain.T1
    except Exception:
        return []

    count = max(sample_count, 8)
    points: List[rhino3dm.Point3d] = []
    for i in range(count):
        t = t_start + (t_end - t_start) * i / (count - 1)
        try:
            pt = curve.PointAt(t)
        except Exception:
            continue
        if not points or not _points_are_close(points[-1], pt):
            points.append(pt)

    if len(points) > 1 and _points_are_close(points[0], points[-1]):
        points = points[:-1]

    return points


def _points_to_2d(points: List[rhino3dm.Point3d]) -> List[Point2D]:
    """将三维点列表投影到 XY 平面，返回二维坐标列表"""
    return [(float(pt.X), float(pt.Y)) for pt in points]


def _polyline_segments(points: List[Point2D]) -> List[Segment2D]:
    """将点列表转换为闭合折线的线段列表"""
    if len(points) < 2:
        return []
    segments: List[Segment2D] = []
    for i in range(len(points)):
        a = points[i]
        b = points[(i + 1) % len(points)]
        if a != b:
            segments.append((a, b))
    return segments


def _distance_point_to_segment(point: Point2D, a: Point2D, b: Point2D) -> float:
    """计算点到线段的最短距离"""
    px, py = point
    ax, ay = a
    bx, by = b
    abx = bx - ax
    aby = by - ay
    apx = px - ax
    apy = py - ay

    denom = abx * abx + aby * aby
    if denom <= 1e-12:
        return math.hypot(apx, apy)

    t = (apx * abx + apy * aby) / denom
    t = max(0.0, min(1.0, t))
    cx = ax + t * abx
    cy = ay + t * aby
    return math.hypot(px - cx, py - cy)


def _min_distance_to_segments(point: Point2D, segments: List[Segment2D]) -> float:
    """计算点到线段集合中最近线段的距离"""
    if not segments:
        return float("inf")
    best = float("inf")
    for a, b in segments:
        dist = _distance_point_to_segment(point, a, b)
        if dist < best:
            best = dist
            if best <= 0:
                break
    return best


def _point_in_polygon_2d(point: Point2D, polygon: List[Point2D]) -> bool:
    """射线法判断点是否在多边形内（XY 平面投影）"""
    if len(polygon) < 3:
        return False
    px, py = point
    intersections = 0
    for i in range(len(polygon)):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % len(polygon)]
        if (y1 > py) != (y2 > py):
            x_intersect = (x2 - x1) * (py - y1) / (y2 - y1) + x1
            if px < x_intersect:
                intersections += 1
    return intersections % 2 == 1


def _point_inside_or_on_curve(
    point: Point3D, curve: rhino3dm.Curve, on_tol: float
) -> bool:
    """判断点是否在闭合曲线内部或边界容差范围内"""
    if not curve.IsClosed:
        return False

    points3d = _curve_to_points(curve)
    polygon = _points_to_2d(points3d)
    if len(polygon) < 3:
        return False

    point2d = (float(point.X), float(point.Y))
    segments = _polyline_segments(polygon)
    if on_tol > 0 and _min_distance_to_segments(point2d, segments) <= on_tol:
        return True

    return _point_in_polygon_2d(point2d, polygon)


def _resolve_object_name(obj: rhino3dm.File3dmObject, fallback: str) -> str:
    """从对象 UserText 或 Attributes 中读取地块/名称，找不到时返回 fallback"""
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


def _extract_boundary_curves(geometry: rhino3dm.CommonObject) -> List[rhino3dm.Curve]:
    """从几何体中提取边界曲线，支持 Curve / Brep / Extrusion 等类型"""
    if isinstance(geometry, rhino3dm.Curve):
        return [geometry]

    if isinstance(geometry, rhino3dm.Extrusion):
        for split in (True, False):
            try:
                brep = geometry.ToBrep(split)
            except TypeError:
                brep = None
            if brep is not None:
                geometry = brep
                break

    for method_name in ("DuplicateNakedEdgeCurves", "DuplicateEdgeCurves"):
        func = getattr(geometry, method_name, None)
        if callable(func):
            try:
                curves = func()
            except Exception:
                curves = None
            if curves:
                return list(curves)

    return []


def _select_building_redline_layer(
    redline_layer: Optional[str], redline_layers: Optional[Sequence[str]]
) -> Optional[str]:
    """从候选图层列表中选择建筑红线图层，优先选择包含"建筑红线"的图层"""
    if redline_layer and redline_layer.strip():
        return redline_layer
    if redline_layers:
        for layer in redline_layers:
            if layer and "建筑红线" in layer:
                return layer
        for layer in redline_layers:
            if layer:
                return layer
    return None


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


def _curve_center(curve: rhino3dm.Curve) -> Optional[Point3D]:
    """计算曲线采样点的几何中心"""
    points = _curve_to_points(curve)
    if not points:
        return None
    sx = sum(pt.X for pt in points)
    sy = sum(pt.Y for pt in points)
    sz = sum(pt.Z for pt in points)
    count = len(points)
    return rhino3dm.Point3d(sx / count, sy / count, sz / count)


def _curve_anchor_point(curve: rhino3dm.Curve) -> Optional[Point3D]:
    """获取曲线的锚点（优先几何中心，其次 BoundingBox 中心，最后首点）"""
    center = _curve_center(curve)
    if center is not None:
        return center
    bbox = _get_bounding_box(curve)
    if bbox is not None:
        return bbox.Center
    points = _curve_to_points(curve)
    if points:
        return points[0]
    return None


def _point_in_bbox_xy(point: Point3D, bbox: rhino3dm.BoundingBox, tol: float = 0.0) -> bool:
    """判断点在 XY 平面上是否位于 BoundingBox 内（含容差）"""
    return (
        (bbox.Min.X - tol) <= point.X <= (bbox.Max.X + tol)
        and (bbox.Min.Y - tol) <= point.Y <= (bbox.Max.Y + tol)
    )


def _match_plot_name_by_point(
    point: Point3D, plot_entries: List[Dict[str, object]], tol: float
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


def check_pedestrian_entrance_count(
    *,
    model_path: Path,
    entrance_layer: str = "场地_人行出入口",
    redline_layer: Optional[str] = "限制_建筑红线",
    redline_layers: Optional[Sequence[str]] = None,
    plot_layer: str = "场景_地块",
    on_curve_tolerance: float = 1.0,
    min_required_count: int = 2,
) -> Dict:
    """
    人行出入口数量检测主函数。
    检测每条建筑红线范围内的人行出入口数量是否满足最低要求（默认 >= 2 个）。
    出入口点需在红线曲线内部或边界容差范围内才计入。
    """
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Failed to read 3dm file: {model_path}")

    entrance_objects = _load_objects_from_layer(file3dm, entrance_layer)
    if not entrance_objects:
        raise ValueError(f"No pedestrian entrance points found in layer: {entrance_layer}")

    building_redline_layer = _select_building_redline_layer(redline_layer, redline_layers)
    if not building_redline_layer:
        raise ValueError("No building redline layer provided")
    redline_layer_list = [building_redline_layer]

    redline_objects: List[Tuple[rhino3dm.File3dmObject, rhino3dm.CommonObject, str]] = []
    for layer_name in redline_layer_list:
        layer_objects = _load_objects_from_layer(file3dm, layer_name)
        for obj, geometry in layer_objects:
            redline_objects.append((obj, geometry, layer_name))

    if not redline_objects:
        raise ValueError("No redline curves found in provided layers")

    redline_entries: List[Dict[str, object]] = []
    open_curves = 0
    invalid_curves = 0

    plot_entries: List[Dict[str, object]] = []
    detected_plot_layer = plot_layer
    plot_objects: List[Tuple[rhino3dm.File3dmObject, rhino3dm.CommonObject]] = []
    for candidate in _candidate_plot_layers(file3dm, plot_layer):
        objs = _load_objects_from_layer(file3dm, candidate)
        if objs:
            plot_objects = objs
            detected_plot_layer = candidate
            break

    for plot_index, (plot_obj, plot_geometry) in enumerate(plot_objects):
        bbox = _get_bounding_box(plot_geometry)
        if bbox is None:
            continue
        plot_name = _resolve_plot_name(plot_obj, f"地块{plot_index + 1}")
        plot_entries.append(
            {
                "name": plot_name,
                "bbox": bbox,
                "center": bbox.Center,
            }
        )

    for redline_obj, geometry, layer_name in redline_objects:
        curves = _extract_boundary_curves(geometry)
        if not curves:
            invalid_curves += 1
            continue
        for curve in curves:
            if not isinstance(curve, rhino3dm.Curve):
                invalid_curves += 1
                continue
            if not curve.IsClosed:
                open_curves += 1
                continue
            anchor = _curve_anchor_point(curve)
            if anchor is None:
                invalid_curves += 1
                continue
            plot_name = _match_plot_name_by_point(anchor, plot_entries, on_curve_tolerance)
            redline_entries.append(
                {
                    "layer": layer_name,
                    "curve": curve,
                    "point": [float(anchor.X), float(anchor.Y), float(anchor.Z)],
                    "redline_name": _resolve_object_name(redline_obj, f"红线{len(redline_entries) + 1}"),
                    "plot_name": plot_name,
                }
            )

    if not redline_entries:
        raise ValueError("No closed redline curves found in provided layers")

    results = []
    passed = 0
    failed = 0
    skipped_points = 0
    redline_counts = [0 for _ in redline_entries]

    for idx, (obj, geometry) in enumerate(entrance_objects):
        point = _geometry_to_point(geometry)
        if point is None:
            skipped_points += 1
            continue

        object_id = getattr(getattr(obj, "Attributes", None), "Id", None)
        name = _resolve_object_name(obj, f"出入口{idx + 1}")

        inside = False
        matched_plot_name: Optional[str] = None
        for entry_index, entry in enumerate(redline_entries):
            if _point_inside_or_on_curve(point, entry["curve"], on_curve_tolerance):
                inside = True
                redline_counts[entry_index] += 1
                if matched_plot_name is None:
                    matched_plot_name = entry.get("plot_name")

        status = "pass" if inside else "fail"
        if inside:
            passed += 1
        else:
            failed += 1

        results.append(
            {
                "index": idx,
                "name": name,
                "object_id": str(object_id) if object_id else None,
                "point": [float(point.X), float(point.Y), float(point.Z)],
                "plot_name": matched_plot_name or _match_plot_name_by_point(point, plot_entries, on_curve_tolerance),
                "status": status,
                "reasons": [] if inside else ["outside_redline"],
            }
        )

    warnings: List[str] = []
    if open_curves > 0:
        warnings.append(f"{open_curves} redline curves are not closed and were ignored")
    if invalid_curves > 0:
        warnings.append(f"{invalid_curves} redline objects are not valid curves")
    if skipped_points > 0:
        warnings.append(f"{skipped_points} entrance objects could not be resolved to points")
    if not plot_entries:
        warnings.append("未找到地块图层或无有效地块边界，红线无法映射地块名称")

    required_min = MIN_REQUIRED_PEDESTRIAN_ENTRANCES
    redline_results = []
    redline_passed = 0
    redline_failed = 0
    for idx, entry in enumerate(redline_entries):
        entrance_count = redline_counts[idx]
        status = "pass" if entrance_count >= required_min else "fail"
        if status == "pass":
            redline_passed += 1
        else:
            redline_failed += 1
        redline_results.append(
            {
                "index": idx,
                "layer": entry["layer"],
                "redline_name": entry.get("redline_name"),
                "point": entry["point"],
                "plot_name": entry.get("plot_name"),
                "entrance_count": entrance_count,
                "status": status,
                "reasons": [] if status == "pass" else ["insufficient_entrances"],
            }
        )

    overall_status = "pass" if redline_failed == 0 else "fail"
    summary_reasons = []
    if overall_status == "fail":
        summary_reasons.append("insufficient_entrances")

    return {
        "status": "ok",
        "summary": {
            "total": len(redline_results),
            "passed": redline_passed,
            "failed": redline_failed,
            "required_min": required_min,
            "status": overall_status,
            "reasons": summary_reasons,
        },
        "redlines": redline_results,
        "results": results,
        "warnings": warnings,
        "parameters": {
            "entrance_layer": entrance_layer,
            "redline_layer": building_redline_layer,
            "redline_layers": redline_layer_list,
            "plot_layer": detected_plot_layer,
            "on_curve_tolerance": on_curve_tolerance,
            "min_required_count": required_min,
        },
    }
