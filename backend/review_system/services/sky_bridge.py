"""
空中连廊检测（纯 Python 实现）

包含两个主函数：
- prepare_sky_bridge_info: 提取地块连接关系，供前端渲染连廊示意图
- check_sky_bridge_pure_python: 检测空中连廊是否满足净高、宽度、高度要求
"""
from __future__ import annotations

import logging
import math
import re
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


def _polygon_centroid(points: List[rhino3dm.Point3d]) -> Optional[Point2D]:
    """计算多边形重心（XY 平面），点数不足时返回 None"""
    if len(points) < 3:
        return None
    area = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(len(points)):
        x1, y1 = points[i].X, points[i].Y
        x2, y2 = points[(i + 1) % len(points)].X, points[(i + 1) % len(points)].Y
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


def _point_in_polygon(point: Point2D, polygon: List[Point2D]) -> bool:
    """射线法判断点是否在多边形内"""
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


def _geometry_is_closed(geometry: rhino3dm.CommonObject) -> bool:
    """判断几何体是否为封闭实体（Brep/Mesh/Extrusion）"""
    if isinstance(geometry, rhino3dm.Brep):
        return bool(getattr(geometry, "IsSolid", False))
    if isinstance(geometry, rhino3dm.Mesh):
        return bool(getattr(geometry, "IsClosed", False))
    if isinstance(geometry, rhino3dm.Extrusion):
        return bool(getattr(geometry, "IsClosed", False))
    return False


def _resolve_object_name(obj: rhino3dm.File3dmObject, fallback: str, key: str) -> str:
    """从对象 UserText 或 Attributes 中读取名称，找不到时返回 fallback"""
    name = _get_user_text(obj, key)
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


def _parse_connection_targets(value: str) -> List[str]:
    """解析逗号分隔的连接目标地块名称列表（支持中英文逗号）"""
    if not value:
        return []
    tokens = re.split(r"[，,]", value)
    return [token.strip() for token in tokens if token.strip()]


def _sorted_pair(a: str, b: str) -> Tuple[str, str]:
    """将两个地块名称排序为固定顺序的元组，用于去重连接对"""
    if a <= b:
        return a, b
    return b, a


def _projected_width(points: List[Point2D], direction: Point2D) -> float:
    """计算多边形在给定方向的垂直投影宽度"""
    if len(points) < 2:
        return 0.0
    dx, dy = direction
    length = math.hypot(dx, dy)
    if length <= 1e-9:
        return 0.0
    px, py = -dy / length, dx / length
    projections = [x * px + y * py for x, y in points]
    return max(projections) - min(projections)


def _safe_bbox_points(bbox: rhino3dm.BoundingBox) -> List[Point2D]:
    """将 BoundingBox 的四个底角转换为二维点列表"""
    return [
        (bbox.Min.X, bbox.Min.Y),
        (bbox.Min.X, bbox.Max.Y),
        (bbox.Max.X, bbox.Max.Y),
        (bbox.Max.X, bbox.Min.Y),
    ]


def prepare_sky_bridge_info(
    model_path: Path,
    plot_layer: str = "场景_地块",
    corridor_layer: str = "模型_空中连廊",
    plot_name_key: str = "地块名称",
    connection_key: str = "空中连接地块",
) -> Dict:
    """
    提取地块连接关系，供前端渲染空中连廊示意图。
    读取地块图层，解析每个地块的 UserText 中的连接目标，
    返回地块列表和连接对列表（去重）。
    """
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Failed to read 3dm file: {model_path}")

    plot_objects = _load_objects_from_layer(file3dm, plot_layer)
    if not plot_objects:
        raise ValueError(f"No plot objects found in layer: {plot_layer}")

    plots = []
    connections: List[Tuple[str, str]] = []
    connection_set: set[Tuple[str, str]] = set()

    for idx, (obj, geometry) in enumerate(plot_objects):
        plot_name = _resolve_object_name(obj, f"地块{idx + 1}", plot_name_key)
        bbox = _get_bounding_box(geometry)
        points = _polygon_points_from_geometry(geometry)
        centroid = _polygon_centroid(points) if points else None
        if centroid and bbox:
            center = rhino3dm.Point3d(centroid[0], centroid[1], bbox.Center.Z)
        elif bbox:
            center = bbox.Center
        elif points:
            center = points[0]
        else:
            center = rhino3dm.Point3d(0, 0, 0)

        top_z = bbox.Max.Z if bbox else max((pt.Z for pt in points), default=0.0)
        plots.append(
            {
                "name": plot_name,
                "center": [float(center.X), float(center.Y), float(center.Z)],
                "polygon": [[float(pt.X), float(pt.Y), float(pt.Z)] for pt in points],
                "top_z": float(top_z),
            }
        )

        connection_value = _get_user_text(obj, connection_key)
        if not connection_value:
            continue
        for target in _parse_connection_targets(connection_value):
            pair = _sorted_pair(plot_name, target)
            if pair not in connection_set:
                connection_set.add(pair)
                connections.append(pair)

    return {
        "status": "ok",
        "plots": plots,
        "connections": [{"from": a, "to": b} for a, b in connections],
        "warnings": [],
        "parameters": {
            "plot_layer": plot_layer,
            "corridor_layer": corridor_layer,
            "plot_name_key": plot_name_key,
            "connection_key": connection_key,
        },
    }


def check_sky_bridge_pure_python(
    model_path: Path,
    plot_layer: str = "场景_地块",
    corridor_layer: str = "模型_空中连廊",
    plot_name_key: str = "地块名称",
    connection_key: str = "空中连接地块",
    elevation: float = 7.0,
    min_width: float = 6.0,
    min_height: float = 4.0,
    connections: Optional[List[List[str]]] = None,
) -> Dict:
    """
    空中连廊检测主函数。
    对每对需要连接的地块，检测其间的连廊体块是否满足：
    - 净高（连廊底部距地块顶面）>= elevation
    - 连廊宽度 >= min_width
    - 连廊自身高度 >= min_height
    - 连廊为封闭实体且同时与两侧地块相交
    connections 为 None 时从模型 UserText 中读取连接关系。
    """
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Failed to read 3dm file: {model_path}")

    plot_objects = _load_objects_from_layer(file3dm, plot_layer)
    corridor_objects = _load_objects_from_layer(file3dm, corridor_layer)

    plots: Dict[str, Dict] = {}
    for idx, (obj, geometry) in enumerate(plot_objects):
        plot_name = _resolve_object_name(obj, f"地块{idx + 1}", plot_name_key)
        bbox = _get_bounding_box(geometry)
        points = _polygon_points_from_geometry(geometry)
        if not points and bbox is not None:
            points = [
                rhino3dm.Point3d(bbox.Min.X, bbox.Min.Y, bbox.Min.Z),
                rhino3dm.Point3d(bbox.Min.X, bbox.Max.Y, bbox.Min.Z),
                rhino3dm.Point3d(bbox.Max.X, bbox.Max.Y, bbox.Min.Z),
                rhino3dm.Point3d(bbox.Max.X, bbox.Min.Y, bbox.Min.Z),
            ]
        centroid = _polygon_centroid(points) if points else None
        if centroid and bbox:
            center = rhino3dm.Point3d(centroid[0], centroid[1], bbox.Center.Z)
        elif bbox:
            center = bbox.Center
        elif points:
            center = points[0]
        else:
            center = rhino3dm.Point3d(0, 0, 0)

        top_z = bbox.Max.Z if bbox else max((pt.Z for pt in points), default=0.0)
        plots[plot_name] = {
            "name": plot_name,
            "center": center,
            "polygon2d": _points_to_2d(points),
            "polygon3d": points,
            "top_z": float(top_z),
        }

    connection_pairs: List[Tuple[str, str]] = []
    if connections:
        for pair in connections:
            if len(pair) < 2:
                continue
            a = str(pair[0]).strip()
            b = str(pair[1]).strip()
            if not a or not b:
                continue
            connection_pairs.append(_sorted_pair(a, b))
    else:
        for idx, (obj, _geometry) in enumerate(plot_objects):
            plot_name = _resolve_object_name(obj, f"地块{idx + 1}", plot_name_key)
            connection_value = _get_user_text(obj, connection_key)
            if not connection_value:
                continue
            for target in _parse_connection_targets(connection_value):
                connection_pairs.append(_sorted_pair(plot_name, target))

    connection_set = sorted(set(connection_pairs))

    corridors = []
    for idx, (obj, geometry) in enumerate(corridor_objects):
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            continue
        points = _polygon_points_from_geometry(geometry)
        polygon2d = _points_to_2d(points) if points else _safe_bbox_points(bbox)
        attributes = getattr(obj, "Attributes", None)
        object_id = getattr(attributes, "Id", None) if attributes else None
        corridors.append(
            {
                "index": idx,
                "polygon2d": polygon2d,
                "polygon3d": points,
                "bbox": bbox,
                "is_closed": _geometry_is_closed(geometry),
                "object_id": str(object_id) if object_id else None,
            }
        )

    results = []
    warnings: List[str] = []
    total_passed = 0
    total_failed = 0

    if not connection_set:
        return {
            "status": "ok",
            "summary": {
                "total_connections": 0,
                "passed": 0,
                "failed": 0,
                "no_connections": 1,
            },
            "results": [],
            "warnings": ["no_connections"],
            "parameters": {
                "plot_layer": plot_layer,
                "corridor_layer": corridor_layer,
                "plot_name_key": plot_name_key,
                "connection_key": connection_key,
                "elevation": elevation,
                "min_width": min_width,
                "min_height": min_height,
            },
        }

    for idx, (plot_a_name, plot_b_name) in enumerate(connection_set):
        plot_a = plots.get(plot_a_name)
        plot_b = plots.get(plot_b_name)

        result = {
            "connection_id": idx,
            "plot_a": plot_a_name,
            "plot_b": plot_b_name,
            "status": "fail",
            "reasons": [],
            "label_position": [0.0, 0.0, 0.0],
            "corridors": [],
        }

        if not plot_a or not plot_b:
            result["reasons"].append("plot_missing")
            results.append(result)
            total_failed += 1
            continue

        center_a = plot_a["center"]
        center_b = plot_b["center"]
        label_x = (center_a.X + center_b.X) * 0.5
        label_y = (center_a.Y + center_b.Y) * 0.5
        label_z = max(plot_a["top_z"], plot_b["top_z"]) + elevation
        result["label_position"] = [float(label_x), float(label_y), float(label_z)]

        direction = (center_b.X - center_a.X, center_b.Y - center_a.Y)
        matched_corridors = 0
        any_pass = False

        for corridor in corridors:
            poly = corridor["polygon2d"]
            intersects_a = _polygons_intersect(poly, plot_a["polygon2d"])
            intersects_b = _polygons_intersect(poly, plot_b["polygon2d"])
            if not (intersects_a or intersects_b):
                continue

            matched_corridors += 1
            bbox = corridor["bbox"]
            height = bbox.Max.Z - bbox.Min.Z
            width = _projected_width(poly, direction)
            if width <= 1e-6:
                width = max(bbox.Max.X - bbox.Min.X, bbox.Max.Y - bbox.Min.Y)

            clearance = bbox.Min.Z - max(plot_a["top_z"], plot_b["top_z"])

            reasons = []
            if not intersects_a or not intersects_b:
                reasons.append("not_connecting")
            if not corridor["is_closed"]:
                reasons.append("not_closed")
            if clearance + 1e-6 < elevation:
                reasons.append("clearance_too_low")
            if width + 1e-6 < min_width:
                reasons.append("width_too_small")
            if height + 1e-6 < min_height:
                reasons.append("height_too_small")

            status = "pass" if not reasons else "fail"
            if status == "pass":
                any_pass = True

            result["corridors"].append(
                {
                    "index": corridor["index"],
                    "status": status,
                    "reasons": reasons,
                    "width": float(width),
                    "height": float(height),
                    "clearance": float(clearance),
                    "is_closed": corridor["is_closed"],
                    "intersects_a": intersects_a,
                    "intersects_b": intersects_b,
                    "object_id": corridor["object_id"],
                    "bbox": {
                        "min": [
                            float(bbox.Min.X),
                            float(bbox.Min.Y),
                            float(bbox.Min.Z),
                        ],
                        "max": [
                            float(bbox.Max.X),
                            float(bbox.Max.Y),
                            float(bbox.Max.Z),
                        ],
                    },
                    "outline_points": [
                        [float(pt.X), float(pt.Y), float(pt.Z)] for pt in corridor["polygon3d"]
                    ],
                }
            )

        reason_order = [
            "plot_missing",
            "missing_corridor",
            "not_connecting",
            "not_closed",
            "clearance_too_low",
            "width_too_small",
            "height_too_small",
        ]

        has_connecting_corridor = any(
            corridor.get("intersects_a") and corridor.get("intersects_b")
            for corridor in result["corridors"]
        )

        if matched_corridors == 0 or not has_connecting_corridor:
            result["reasons"] = ["missing_corridor"]
        elif any_pass:
            result["reasons"] = []
        else:
            reason_set = set(result["reasons"])
            for corridor in result["corridors"]:
                for reason in corridor.get("reasons", []):
                    reason_set.add(reason)
            result["reasons"] = [reason for reason in reason_order if reason in reason_set]

        if any_pass:
            result["status"] = "pass"
            total_passed += 1
        else:
            total_failed += 1

        results.append(result)

    return {
        "status": "ok",
        "summary": {
            "total_connections": len(results),
            "passed": total_passed,
            "failed": total_failed,
            "no_connections": 0,
        },
        "results": results,
        "warnings": warnings,
        "parameters": {
            "plot_layer": plot_layer,
            "corridor_layer": corridor_layer,
            "plot_name_key": plot_name_key,
            "connection_key": connection_key,
            "elevation": elevation,
            "min_width": min_width,
            "min_height": min_height,
        },
    }
