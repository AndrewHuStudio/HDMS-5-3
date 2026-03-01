"""
广场退线违规检测（纯 Python 实现）

检测建筑体块是否侵入广场退线范围。
支持带洞多边形（外轮廓 + 内孔），高度低于 ignore_height 的建筑自动忽略。
"""
from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import rhino3dm

from core.utils import get_bounding_box as _get_bounding_box
from core.utils import get_user_text as _get_user_text

logger = logging.getLogger(__name__)

Point2D = Tuple[float, float]


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


def _points_to_2d(points: Iterable[rhino3dm.Point3d]) -> List[Point2D]:
    """将三维点列表投影到 XY 平面，返回二维坐标列表"""
    return [(float(pt.X), float(pt.Y)) for pt in points]


def _convex_hull(points: List[Point2D]) -> List[Point2D]:
    """Andrew's Monotone Chain 算法计算二维凸包"""
    unique = sorted(set(points))
    if len(unique) < 3:
        return unique

    def cross(o: Point2D, a: Point2D, b: Point2D) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: List[Point2D] = []
    for p in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    upper: List[Point2D] = []
    for p in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    return lower[:-1] + upper[:-1]


def _polygon_points_from_geometry(geometry: rhino3dm.CommonObject) -> List[rhino3dm.Point3d]:
    """从几何体中提取底面轮廓点（XY 平面），支持 Curve/Extrusion/Brep/Mesh，失败时退化为 BoundingBox"""
    if isinstance(geometry, rhino3dm.Curve):
        return _curve_to_points(geometry)
    if isinstance(geometry, rhino3dm.Extrusion):
        try:
            brep = geometry.ToBrep(True)
        except Exception:
            brep = None
        if brep is not None:
            geometry = brep
    if isinstance(geometry, rhino3dm.Brep):
        try:
            vertices = [vertex.Location for vertex in geometry.Vertices]
        except Exception:
            vertices = []
        if vertices:
            min_z = min(vertex.Z for vertex in vertices)
            bottom_points = [pt for pt in vertices if abs(pt.Z - min_z) <= 1e-4]
            hull = _convex_hull(_points_to_2d(bottom_points))
            return [rhino3dm.Point3d(x, y, min_z) for x, y in hull]
    if isinstance(geometry, rhino3dm.Mesh):
        try:
            vertices = geometry.Vertices
            points3d = [vertices[i] for i in range(vertices.Count)]
        except Exception:
            points3d = []
        if points3d:
            min_z = min(pt.Z for pt in points3d)
            bottom_points = [pt for pt in points3d if abs(pt.Z - min_z) <= 1e-4]
            hull = _convex_hull(_points_to_2d(bottom_points))
            return [rhino3dm.Point3d(x, y, min_z) for x, y in hull]
    bbox = _get_bounding_box(geometry)
    if bbox is None:
        return []
    z = bbox.Min.Z
    return [
        rhino3dm.Point3d(bbox.Min.X, bbox.Min.Y, z),
        rhino3dm.Point3d(bbox.Min.X, bbox.Max.Y, z),
        rhino3dm.Point3d(bbox.Max.X, bbox.Max.Y, z),
        rhino3dm.Point3d(bbox.Max.X, bbox.Min.Y, z),
    ]


def _polygon_area(points: List[Point2D]) -> float:
    """用 Shoelace 公式计算二维多边形有符号面积"""
    if len(points) < 3:
        return 0.0
    area = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return area * 0.5


def _polygon_centroid(points: List[Point2D]) -> Optional[Point2D]:
    """计算多边形重心（XY 平面），点数不足时返回 None"""
    if len(points) < 3:
        return None
    area = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        cross = x1 * y2 - x2 * y1
        area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(area) <= 1e-9:
        return None
    area *= 0.5
    cx /= 6.0 * area
    cy /= 6.0 * area
    return (cx, cy)


def _point_on_segment(point: Point2D, a: Point2D, b: Point2D, tol: float = 1e-6) -> bool:
    """判断点是否在线段上（叉积为零且点积非正）"""
    (px, py) = point
    (x1, y1) = a
    (x2, y2) = b
    cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1)
    if abs(cross) > tol:
        return False
    dot = (px - x1) * (px - x2) + (py - y1) * (py - y2)
    return dot <= tol


def _point_in_polygon(point: Point2D, polygon: List[Point2D]) -> bool:
    """射线法判断点是否在多边形内（边上的点视为在内部）"""
    if len(polygon) < 3:
        return False
    px, py = point
    intersections = 0
    for i in range(len(polygon)):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % len(polygon)]
        if _point_on_segment(point, (x1, y1), (x2, y2)):
            return True
        if (y1 > py) != (y2 > py):
            x_intersect = (x2 - x1) * (py - y1) / (y2 - y1) + x1
            if px < x_intersect:
                intersections += 1
    return intersections % 2 == 1


def _segments_intersect(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D) -> bool:
    """判断两条线段是否相交（含端点共线情况）"""
    def orient(p: Point2D, q: Point2D, r: Point2D) -> float:
        return (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])

    def on_segment(p: Point2D, q: Point2D, r: Point2D) -> bool:
        return (
            min(p[0], r[0]) <= q[0] <= max(p[0], r[0])
            and min(p[1], r[1]) <= q[1] <= max(p[1], r[1])
        )

    o1 = orient(a1, a2, b1)
    o2 = orient(a1, a2, b2)
    o3 = orient(b1, b2, a1)
    o4 = orient(b1, b2, a2)

    if o1 == 0 and on_segment(a1, b1, a2):
        return True
    if o2 == 0 and on_segment(a1, b2, a2):
        return True
    if o3 == 0 and on_segment(b1, a1, b2):
        return True
    if o4 == 0 and on_segment(b1, a2, b2):
        return True

    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def _polygons_intersect(poly_a: List[Point2D], poly_b: List[Point2D]) -> bool:
    """判断两个多边形是否相交（含包含关系）"""
    if len(poly_a) < 3 or len(poly_b) < 3:
        return False
    for point in poly_a:
        if _point_in_polygon(point, poly_b):
            return True
    for point in poly_b:
        if _point_in_polygon(point, poly_a):
            return True
    for i in range(len(poly_a)):
        a1 = poly_a[i]
        a2 = poly_a[(i + 1) % len(poly_a)]
        for j in range(len(poly_b)):
            b1 = poly_b[j]
            b2 = poly_b[(j + 1) % len(poly_b)]
            if _segments_intersect(a1, a2, b1, b2):
                return True
    return False


def _polygon_fully_inside(inner: List[Point2D], outer: List[Point2D]) -> bool:
    """判断 inner 多边形是否完全在 outer 多边形内部"""
    if len(inner) < 3 or len(outer) < 3:
        return False
    for pt in inner:
        if not _point_in_polygon(pt, outer):
            return False
    for i in range(len(inner)):
        a1 = inner[i]
        a2 = inner[(i + 1) % len(inner)]
        for j in range(len(outer)):
            b1 = outer[j]
            b2 = outer[(j + 1) % len(outer)]
            if _segments_intersect(a1, a2, b1, b2):
                if not (_point_on_segment(a1, b1, b2) or _point_on_segment(a2, b1, b2)):
                    return False
    return True


def _resolve_object_name(obj: rhino3dm.File3dmObject, fallback: str) -> str:
    """从对象 UserText 或 Attributes 中读取建筑名称，找不到时返回 fallback"""
    name = _get_user_text(obj, "建筑名称") or _get_user_text(obj, "名称")
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


def _resolve_plaza_name(obj: rhino3dm.File3dmObject, fallback: str) -> str:
    """从对象 UserText 或 Attributes 中读取广场/地块名称，找不到时返回 fallback"""
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


def _point_in_bbox_xy(point: rhino3dm.Point3d, bbox: rhino3dm.BoundingBox, tol: float = 0.0) -> bool:
    """判断点在 XY 平面上是否位于 BoundingBox 内（含容差）"""
    return (
        (bbox.Min.X - tol) <= point.X <= (bbox.Max.X + tol)
        and (bbox.Min.Y - tol) <= point.Y <= (bbox.Max.Y + tol)
    )


def _match_plot_name_by_point(
    point: rhino3dm.Point3d, plot_entries: List[Dict[str, object]], tol: float = 0.0
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


def _group_plaza_areas(entries: List[Dict]) -> List[Dict[str, List[Dict]]]:
    """
    将广场退线区域按包含关系分组为外轮廓和内孔。
    面积大的区域包含面积小的区域时，小区域作为孔洞。
    """
    entries_sorted = sorted(entries, key=lambda item: item["area"], reverse=True)
    areas: List[Dict[str, List[Dict]]] = []

    for entry in entries_sorted:
        container_index = None
        for i, area in enumerate(areas):
            if _point_in_polygon(entry["centroid"], area["outer"]["points2d"]):
                if container_index is None:
                    container_index = i
                else:
                    if area["outer"]["area"] < areas[container_index]["outer"]["area"]:
                        container_index = i
        if container_index is None:
            areas.append({"outer": entry, "holes": []})
        else:
            areas[container_index]["holes"].append(entry)

    return areas


def check_plaza_setback_violation(
    *,
    model_path: Path,
    plaza_setback_layer: str = "场地_广场退线",
    building_layer: str = "模型_建筑体块",
    plot_layer: str = "场景_地块",
    ignore_height: float = 2.0,
) -> Dict:
    """
    广场退线违规检测主函数。
    检测建筑体块是否侵入广场退线范围。
    支持带洞多边形（外轮廓 + 内孔），高度低于 ignore_height 的建筑自动忽略。
    """
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Failed to read 3dm file: {model_path}")

    plaza_objects = _load_objects_from_layer(file3dm, plaza_setback_layer)
    if not plaza_objects:
        raise ValueError(f"No plaza setback curves found in layer: {plaza_setback_layer}")

    building_objects = _load_objects_from_layer(file3dm, building_layer)
    if not building_objects:
        raise ValueError(f"No buildings found in layer: {building_layer}")

    warnings: List[str] = []
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
        plot_entries.append(
            {
                "name": _resolve_plot_name(plot_obj, f"地块{plot_index + 1}"),
                "bbox": bbox,
                "center": bbox.Center,
            }
        )
    if not plot_entries:
        warnings.append("未找到地块图层或无有效地块边界，建筑无法映射地块名称")

    plaza_entries: List[Dict] = []
    invalid_curves = 0

    for idx, (obj, geometry) in enumerate(plaza_objects):
        if isinstance(geometry, rhino3dm.Curve):
            points = _curve_to_points(geometry)
        else:
            points = _polygon_points_from_geometry(geometry)

        if len(points) < 3:
            invalid_curves += 1
            continue

        poly2d = _points_to_2d(points)
        if len(poly2d) < 3:
            invalid_curves += 1
            continue
        min_z = min(float(pt.Z) for pt in points)
        centroid = _polygon_centroid(poly2d) or poly2d[0]
        area = abs(_polygon_area(poly2d))
        name = _resolve_plaza_name(obj, f"广场{idx + 1}")
        plaza_entries.append(
            {
                "points2d": poly2d,
                "min_z": min_z,
                "centroid": centroid,
                "area": area,
                "name": name,
            }
        )

    if not plaza_entries:
        raise ValueError(f"No valid plaza setback curves found in layer: {plaza_setback_layer}")

    plaza_areas = _group_plaza_areas(plaza_entries)
    plaza_area_shapes = []
    for index, area in enumerate(plaza_areas, start=1):
        outer = area["outer"]
        area_name = outer.get("name") or f"广场{index}"
        area["name"] = area_name
        outer_z = outer["min_z"]
        outer_points = [[x, y, outer_z] for x, y in outer["points2d"]]
        holes = []
        for hole in area["holes"]:
            hole_z = hole["min_z"]
            holes.append([[x, y, hole_z] for x, y in hole["points2d"]])
        plaza_area_shapes.append(
            {
                "name": area_name,
                "outer": outer_points,
                "holes": holes,
                "base_z": outer_z,
            }
        )

    results = []
    area_stats: Dict[str, Dict[str, int]] = {}
    violations = 0
    checked_buildings = 0
    ignored_buildings = 0

    for idx, (obj, geometry) in enumerate(building_objects):
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            continue
        height = float(bbox.Max.Z - bbox.Min.Z)
        building_name = _resolve_object_name(obj, f"建筑{idx + 1}")
        attributes = getattr(obj, "Attributes", None)
        object_id = getattr(attributes, "Id", None) if attributes else None
        plot_name = _match_plot_name_by_point(bbox.Center, plot_entries, 0.0) if plot_entries else None

        if height <= ignore_height:
            ignored_buildings += 1
            results.append(
                {
                    "building_name": building_name,
                    "object_id": str(object_id) if object_id else None,
                    "height": height,
                    "is_violation": False,
                    "reasons": ["below_ignore_height"],
                    "plaza_name": None,
                    "plot_name": plot_name,
                }
            )
            continue

        checked_buildings += 1
        points = _polygon_points_from_geometry(geometry)
        footprint = _points_to_2d(points) if points else []
        if len(footprint) < 3:
            footprint = [
                (bbox.Min.X, bbox.Min.Y),
                (bbox.Min.X, bbox.Max.Y),
                (bbox.Max.X, bbox.Max.Y),
                (bbox.Max.X, bbox.Min.Y),
            ]

        matched_area: Optional[Dict] = None
        for area in plaza_areas:
            outer = area["outer"]["points2d"]
            if not _polygons_intersect(footprint, outer):
                continue

            inside_hole = False
            for hole in area["holes"]:
                if _polygon_fully_inside(footprint, hole["points2d"]):
                    inside_hole = True
                    break
            if inside_hole:
                continue

            if matched_area is None:
                matched_area = area
            else:
                if area["outer"]["area"] < matched_area["outer"]["area"]:
                    matched_area = area

        is_violation = matched_area is not None
        plaza_name = matched_area["name"] if matched_area else None

        if is_violation:
            violations += 1
            if plaza_name:
                area_stats.setdefault(plaza_name, {"checked": 0, "violations": 0})
                area_stats[plaza_name]["checked"] += 1
                area_stats[plaza_name]["violations"] += 1

        results.append(
            {
                "building_name": building_name,
                "object_id": str(object_id) if object_id else None,
                "height": height,
                "is_violation": is_violation,
                "reasons": ["inside_plaza_setback"] if is_violation else [],
                "plaza_name": plaza_name,
                "plot_name": plot_name,
            }
        )

    if invalid_curves > 0:
        warnings.append(f"{invalid_curves} plaza setback curves are not valid")

    area_results = []
    for index, area in enumerate(plaza_areas, start=1):
        name = area.get("name") or f"广场{index}"
        stats = area_stats.get(name, {"checked": 0, "violations": 0})
        status = "fail" if stats["violations"] > 0 else "pass"
        area_results.append(
            {
                "name": name,
                "status": status,
                "checked_buildings": stats["checked"],
                "violations": stats["violations"],
            }
        )

    return {
        "status": "ok",
        "summary": {
            "total_buildings": len(building_objects),
            "checked_buildings": checked_buildings,
            "ignored_buildings": ignored_buildings,
            "violations": violations,
            "compliant": max(0, checked_buildings - violations),
        },
        "results": results,
        "area_results": area_results,
        "plaza_areas": plaza_area_shapes,
        "warnings": warnings,
        "parameters": {
            "plaza_setback_layer": plaza_setback_layer,
            "building_layer": building_layer,
            "plot_layer": detected_plot_layer,
            "ignore_height": ignore_height,
        },
    }
