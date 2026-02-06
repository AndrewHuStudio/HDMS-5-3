from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import rhino3dm

from rhino_api.core.utils import get_bounding_box as _get_bounding_box
from rhino_api.core.utils import get_user_text as _get_user_text

logger = logging.getLogger(__name__)

Point2D = Tuple[float, float]
Segment2D = Tuple[Point2D, Point2D]


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


def _points_are_close(a: rhino3dm.Point3d, b: rhino3dm.Point3d, tol: float = 1e-6) -> bool:
    return (
        math.isclose(a.X, b.X, abs_tol=tol)
        and math.isclose(a.Y, b.Y, abs_tol=tol)
        and math.isclose(a.Z, b.Z, abs_tol=tol)
    )


def _curve_to_points(curve: rhino3dm.Curve, sample_count: int = 120) -> List[rhino3dm.Point3d]:
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
    return [(float(pt.X), float(pt.Y)) for pt in points]


def _polyline_segments(points: List[Point2D], closed: bool = True) -> List[Segment2D]:
    if len(points) < 2:
        return []
    segments: List[Segment2D] = []
    limit = len(points) if closed else len(points) - 1
    for i in range(limit):
        a = points[i]
        b = points[(i + 1) % len(points)]
        if a != b:
            segments.append((a, b))
    return segments


def _polyline_length(points: List[Point2D]) -> float:
    if len(points) < 2:
        return 0.0
    length = 0.0
    for i in range(len(points) - 1):
        ax, ay = points[i]
        bx, by = points[i + 1]
        length += math.hypot(bx - ax, by - ay)
    return length


def _distance_point_to_segment(point: Point2D, a: Point2D, b: Point2D) -> float:
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


def _min_distance_between_segments(segments_a: List[Segment2D], segments_b: List[Segment2D]) -> float:
    if not segments_a or not segments_b:
        return float("inf")
    best = float("inf")
    for a, b in segments_a:
        midpoint = ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)
        dist = _min_distance_to_segments(midpoint, segments_b)
        if dist < best:
            best = dist
            if best <= 0:
                break
    return best


def _point_in_curve_2d(point: rhino3dm.Point3d, curve: rhino3dm.Curve) -> bool:
    if not curve.IsClosed:
        return False

    points = _curve_to_points(curve)
    if len(points) < 3:
        return False

    px, py = point.X, point.Y
    intersections = 0
    for i in range(len(points)):
        p1 = points[i]
        p2 = points[(i + 1) % len(points)]
        if (p1.Y > py) != (p2.Y > py):
            x_intersect = (p2.X - p1.X) * (py - p1.Y) / (p2.Y - p1.Y) + p1.X
            if px < x_intersect:
                intersections += 1
    return intersections % 2 == 1


def _point_in_polygon_2d(point: rhino3dm.Point3d, polygon: List[rhino3dm.Point3d]) -> bool:
    if len(polygon) < 3:
        return False
    px, py = point.X, point.Y
    intersections = 0
    for i in range(len(polygon)):
        p1 = polygon[i]
        p2 = polygon[(i + 1) % len(polygon)]
        if (p1.Y > py) != (p2.Y > py):
            x_intersect = (p2.X - p1.X) * (py - p1.Y) / (p2.Y - p1.Y) + p1.X
            if px < x_intersect:
                intersections += 1
    return intersections % 2 == 1


def _points_inside_curve(points: List[rhino3dm.Point3d], curve: rhino3dm.Curve, tol: float = 1e-6) -> bool:
    if not points:
        return False
    curve_points = _curve_to_points(curve, sample_count=200)
    curve_segments = _polyline_segments(_points_to_2d(curve_points), closed=True)
    for pt in points:
        if _point_in_curve_2d(pt, curve):
            continue
        if _min_distance_to_segments((pt.X, pt.Y), curve_segments) <= tol:
            continue
        return False
    return True


def _convex_hull(points: List[Point2D]) -> List[Point2D]:
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


def _curve_is_flat_at_z(curve: rhino3dm.Curve, target_z: float, tol: float) -> bool:
    points = _curve_to_points(curve, sample_count=12)
    if not points:
        return False
    return all(abs(pt.Z - target_z) <= tol for pt in points)


def _edge_curve(edge: rhino3dm.BrepEdge) -> Optional[rhino3dm.Curve]:
    for attr in ("DuplicateCurve", "ToNurbsCurve", "ToCurve"):
        func = getattr(edge, attr, None)
        if callable(func):
            try:
                curve = func()
            except Exception:
                curve = None
            if curve is not None:
                return curve
    return None


def _bottom_edge_segments_from_brep(
    brep: rhino3dm.Brep, z_tol: float = 1e-4
) -> List[Segment2D]:
    try:
        vertices = [vertex.Location for vertex in brep.Vertices]
    except Exception:
        vertices = []
    if not vertices:
        return []
    min_z = min(vertex.Z for vertex in vertices)

    segments: List[Segment2D] = []
    for edge in brep.Edges:
        curve = _edge_curve(edge)
        if curve is None:
            continue
        if _curve_is_flat_at_z(curve, min_z, z_tol):
            points2d = _points_to_2d(_curve_to_points(curve, sample_count=16))
            if len(points2d) >= 2:
                segments.extend(_polyline_segments(points2d, closed=False))
    return segments


def _bottom_edge_segments(geometry: rhino3dm.CommonObject) -> List[Segment2D]:
    if isinstance(geometry, rhino3dm.Curve) and geometry.IsClosed:
        points = _points_to_2d(_curve_to_points(geometry))
        if len(points) >= 3:
            return _polyline_segments(points, closed=True)

    if isinstance(geometry, rhino3dm.Extrusion):
        for split in (True, False):
            try:
                brep = geometry.ToBrep(split)
            except TypeError:
                brep = None
            if brep is not None:
                geometry = brep
                break

    if isinstance(geometry, rhino3dm.Brep):
        segments = _bottom_edge_segments_from_brep(geometry)
        if segments:
            return segments

    if isinstance(geometry, rhino3dm.Mesh):
        try:
            vertices = geometry.Vertices
            points3d = [vertices[i] for i in range(vertices.Count)]
        except Exception:
            points3d = []
        if points3d:
            min_z = min(pt.Z for pt in points3d)
            bottom_points = [pt for pt in points3d if abs(pt.Z - min_z) <= 1e-4]
            points2d = _points_to_2d(bottom_points)
            hull = _convex_hull(points2d)
            if len(hull) >= 3:
                return _polyline_segments(hull, closed=True)

    if isinstance(geometry, rhino3dm.Surface):
        try:
            brep = geometry.ToBrep()
        except Exception:
            brep = None
        if brep is not None:
            segments = _bottom_edge_segments_from_brep(brep)
            if segments:
                return segments

    bbox = _get_bounding_box(geometry)
    if bbox is None:
        return []
    rect = [
        (bbox.Min.X, bbox.Min.Y),
        (bbox.Min.X, bbox.Max.Y),
        (bbox.Max.X, bbox.Max.Y),
        (bbox.Max.X, bbox.Min.Y),
    ]
    return _polyline_segments(rect, closed=True)


def _polygon_points_from_geometry(geometry: rhino3dm.CommonObject) -> List[rhino3dm.Point3d]:
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
        segments = _bottom_edge_segments_from_brep(geometry)
        if segments:
            points: List[rhino3dm.Point3d] = []
            for seg in segments:
                points.append(rhino3dm.Point3d(seg[0][0], seg[0][1], 0.0))
            return points
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


def _polygon_centroid_2d(points: List[rhino3dm.Point3d]) -> Optional[Point2D]:
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


def _extract_boundary_curves(geometry: rhino3dm.CommonObject) -> List[rhino3dm.Curve]:
    if isinstance(geometry, rhino3dm.Curve):
        return [geometry]

    for method_name in ("DuplicateNakedEdgeCurves", "DuplicateEdgeCurves"):
        method = getattr(geometry, method_name, None)
        if callable(method):
            try:
                curves = list(method())
            except Exception:
                curves = []
            if curves:
                return curves

    to_brep = getattr(geometry, "ToBrep", None)
    if callable(to_brep):
        try:
            brep = to_brep()
        except Exception:
            brep = None
        if brep is not None and brep is not geometry:
            return _extract_boundary_curves(brep)

    return []


def _segment_length(segment: Segment2D) -> float:
    (ax, ay), (bx, by) = segment
    return math.hypot(bx - ax, by - ay)


def _segments_share_point(a: Segment2D, b: Segment2D, tol: float = 1e-6) -> bool:
    for p1 in a:
        for p2 in b:
            if math.isclose(p1[0], p2[0], abs_tol=tol) and math.isclose(p1[1], p2[1], abs_tol=tol):
                return True
    return False


def _opposite_edge(segments: List[Segment2D], target: Segment2D) -> Optional[Segment2D]:
    for segment in segments:
        if segment == target:
            continue
        if not _segments_share_point(segment, target):
            return segment
    return None


def _segment_midpoint(segment: Segment2D) -> Point2D:
    (ax, ay), (bx, by) = segment
    return ((ax + bx) * 0.5, (ay + by) * 0.5)


def _ladder_dimensions(
    ladder_segments: List[Segment2D],
    building_segments: List[Segment2D],
) -> Tuple[float, float, float]:
    if not ladder_segments:
        return 0.0, 0.0, float("inf")
    lengths = [_segment_length(seg) for seg in ladder_segments]
    long_side = max(lengths) if lengths else 0.0

    nearest_edge = None
    nearest_dist = float("inf")
    for seg in ladder_segments:
        midpoint = _segment_midpoint(seg)
        dist = _min_distance_to_segments(midpoint, building_segments)
        if dist < nearest_dist:
            nearest_dist = dist
            nearest_edge = seg

    width = 0.0
    if nearest_edge is not None:
        far_edge = _opposite_edge(ladder_segments, nearest_edge)
        if far_edge is not None:
            midpoint = _segment_midpoint(nearest_edge)
            width = _distance_point_to_segment(midpoint, far_edge[0], far_edge[1])

    return width, long_side, nearest_dist


def _resolve_object_name(obj: rhino3dm.File3dmObject, fallback: str) -> str:
    name = _get_user_text(obj, "建筑名称")
    if name:
        return name
    attributes = getattr(obj, "Attributes", None)
    if attributes:
        for attr_name in ("Name", "name", "ObjectName", "objectName"):
            value = getattr(attributes, attr_name, None)
            if callable(value):
                try:
                    value = value()
                except Exception:
                    value = None
            if isinstance(value, str) and value.strip():
                return value.strip()
    return fallback


def _resolve_redline_name(obj: rhino3dm.File3dmObject, fallback: str) -> str:
    for key in ("地块名称", "地块名", "地块"):
        value = _get_user_text(obj, key)
        if value:
            return value
    attributes = getattr(obj, "Attributes", None)
    if attributes:
        for attr_name in ("Name", "name", "ObjectName", "objectName"):
            value = getattr(attributes, attr_name, None)
            if callable(value):
                try:
                    value = value()
                except Exception:
                    value = None
            if isinstance(value, str) and value.strip():
                return value.strip()
    return fallback


def _plot_name_from_object(obj: rhino3dm.File3dmObject, fallback: str) -> str:
    for key in ("地块名称", "地块名", "地块"):
        value = _get_user_text(obj, key)
        if value:
            return value
    attributes = getattr(obj, "Attributes", None)
    if attributes:
        for attr_name in ("Name", "name", "ObjectName", "objectName"):
            value = getattr(attributes, attr_name, None)
            if callable(value):
                try:
                    value = value()
                except Exception:
                    value = None
            if isinstance(value, str) and value.strip():
                return value.strip()
    return fallback


def check_fire_ladder_pure_python(
    model_path: Path,
    building_layer: str = "模型_建筑体块",
    fire_ladder_layer: str = "模型_消防登高面",
    redline_layer: str = "限制_建筑红线",
    plot_layer: str = "场景_地块",
    min_width: float = 10.0,
    min_distance: float = 5.0,
    max_distance: float = 10.0,
    length_ratio: float = 0.25,
) -> Dict:
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Failed to read 3dm file: {model_path}")

    building_objects = _load_objects_from_layer(file3dm, building_layer)
    redline_objects = _load_objects_from_layer(file3dm, redline_layer)
    plot_objects = _load_objects_from_layer(file3dm, plot_layer)
    ladder_objects = _load_objects_from_layer(file3dm, fire_ladder_layer)

    if not redline_objects:
        raise ValueError(f"No redline objects found in layer: {redline_layer}")

    buildings = []
    for idx, (obj, geometry) in enumerate(building_objects):
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            continue
        segments = _bottom_edge_segments(geometry)
        if not segments:
            segments = _bottom_edge_segments(geometry)
        if not segments:
            rect = [
                (bbox.Min.X, bbox.Min.Y),
                (bbox.Min.X, bbox.Max.Y),
                (bbox.Max.X, bbox.Max.Y),
                (bbox.Max.X, bbox.Min.Y),
            ]
            segments = _polyline_segments(rect, closed=True)
        perimeter = sum(_segment_length(seg) for seg in segments)
        attributes = getattr(obj, "Attributes", None)
        object_id = getattr(attributes, "Id", None) if attributes else None
        buildings.append(
            {
                "index": idx,
                "name": _resolve_object_name(obj, f"建筑{idx + 1}"),
                "center": bbox.Center,
                "segments": segments,
                "perimeter": perimeter,
                "object_id": str(object_id) if object_id else None,
            }
        )

    plot_entries = []
    for idx, (obj, geometry) in enumerate(plot_objects):
        plot_name = _plot_name_from_object(obj, f"地块{idx + 1}")
        plot_bbox = _get_bounding_box(geometry)
        plot_center = plot_bbox.Center if plot_bbox else None
        plot_points = _polygon_points_from_geometry(geometry)
        if len(plot_points) >= 3:
            plot_entries.append(
                {"name": plot_name, "points": plot_points, "curve": None, "center": plot_center}
            )
            continue
        curves = _extract_boundary_curves(geometry)
        for curve in curves:
            if not curve.IsClosed:
                continue
            plot_entries.append({"name": plot_name, "points": [], "curve": curve, "center": plot_center})

    redlines = []
    for idx, (obj, geometry) in enumerate(redline_objects):
        curve = geometry if isinstance(geometry, rhino3dm.Curve) else None
        if curve is None:
            continue
        if not curve.IsClosed:
            logger.warning("Redline %s is not closed; skipping.", idx + 1)
            continue
        name = _resolve_redline_name(obj, f"红线{idx + 1}")
        points = _curve_to_points(curve)
        centroid = _polygon_centroid_2d(points)
        if centroid is not None:
            avg_z = sum(pt.Z for pt in points) / len(points) if points else 0.0
            center = rhino3dm.Point3d(centroid[0], centroid[1], avg_z)
        else:
            bbox = _get_bounding_box(geometry)
            center = bbox.Center if bbox else rhino3dm.Point3d(0, 0, 0)
        if plot_entries:
            sample_points = points if points else [center]
            matched_name = None
            best_hits = 0
            for plot in plot_entries:
                hits = 0
                for pt in sample_points:
                    if plot.get("points"):
                        if _point_in_polygon_2d(pt, plot["points"]):
                            hits += 1
                    else:
                        curve = plot.get("curve")
                        if curve is not None and _point_in_curve_2d(pt, curve):
                            hits += 1
                if hits > best_hits:
                    best_hits = hits
                    matched_name = plot["name"]
            if matched_name and best_hits > 0:
                name = matched_name
            else:
                nearest_name = None
                nearest_dist = float("inf")
                for plot in plot_entries:
                    plot_center = plot.get("center")
                    if plot_center is None:
                        continue
                    dist = math.hypot(center.X - plot_center.X, center.Y - plot_center.Y)
                    if dist < nearest_dist:
                        nearest_dist = dist
                        nearest_name = plot["name"]
                if nearest_name:
                    name = nearest_name
        redlines.append(
            {
                "index": idx,
                "name": name,
                "curve": curve,
                "center": center,
            }
        )

    ladders = []
    for idx, (obj, geometry) in enumerate(ladder_objects):
        points = _polygon_points_from_geometry(geometry)
        if len(points) < 4:
            continue
        bbox = _get_bounding_box(geometry)
        center = bbox.Center if bbox else points[0]
        segments = _polyline_segments(_points_to_2d(points), closed=True)
        attributes = getattr(obj, "Attributes", None)
        object_id = getattr(attributes, "Id", None) if attributes else None
        ladders.append(
            {
                "index": idx,
                "points": points,
                "segments": segments,
                "center": center,
                "object_id": str(object_id) if object_id else None,
            }
        )

    results = []
    warnings: List[str] = []
    total_passed = 0
    total_failed = 0
    total_no_buildings = 0

    for redline in redlines:
        curve = redline["curve"]
        redline_buildings = [b for b in buildings if _point_in_curve_2d(b["center"], curve)]
        redline_ladders = [l for l in ladders if _point_in_curve_2d(l["center"], curve)]

        result = {
            "redline_index": redline["index"],
            "redline_name": redline["name"],
            "status": "pass",
            "reasons": [],
            "building": None,
            "label_position": [float(redline["center"].X), float(redline["center"].Y), float(redline["center"].Z)],
            "ladders": [],
            "length_sum": 0.0,
            "length_required": 0.0,
        }

        if not redline_buildings:
            total_passed += 1
            total_no_buildings += 1
            result["reasons"].append("no_buildings")
            results.append(result)
            continue

        if not redline_ladders:
            total_failed += 1
            result["status"] = "fail"
            result["reasons"].append("missing_ladder")
            primary_building = redline_buildings[0]
            result["building"] = {
                "name": primary_building["name"],
                "object_id": primary_building["object_id"],
                "perimeter": primary_building["perimeter"],
            }
            results.append(result)
            continue

        ladder_details = []
        ladder_length_sum = 0.0
        width_ok = True
        distance_ok = True
        inside_ok = True

        primary_building = None
        primary_distance = float("inf")

        for ladder in redline_ladders:
            matched_building = None
            matched_distance = float("inf")
            for building in redline_buildings:
                dist = _min_distance_to_segments(
                    (ladder["center"].X, ladder["center"].Y), building["segments"]
                )
                if dist < matched_distance:
                    matched_distance = dist
                    matched_building = building

            if matched_building is None:
                continue

            ladder_inside = _points_inside_curve(ladder["points"], curve)
            width, length, near_distance = _ladder_dimensions(
                ladder["segments"], matched_building["segments"]
            )
            ladder_length_sum += length

            if matched_distance < primary_distance:
                primary_distance = matched_distance
                primary_building = matched_building

            ladder_detail = {
                "index": ladder["index"],
                "width": width,
                "length": length,
                "distance": near_distance,
                "inside_redline": ladder_inside,
                "object_id": ladder.get("object_id"),
                "building_object_id": matched_building["object_id"],
                "building_name": matched_building["name"],
                "outline_points": [
                    [float(pt.X), float(pt.Y), float(pt.Z)] for pt in ladder["points"]
                ],
            }
            ladder_details.append(ladder_detail)

            if width < min_width:
                width_ok = False
            eps = 1e-3
            if near_distance < (min_distance - eps) or near_distance > (max_distance + eps):
                distance_ok = False
            if not ladder_inside:
                inside_ok = False

        if primary_building is None:
            primary_building = redline_buildings[0]

        length_required = primary_building["perimeter"] * length_ratio
        length_ok = ladder_length_sum >= length_required

        result["building"] = {
            "name": primary_building["name"],
            "object_id": primary_building["object_id"],
            "perimeter": primary_building["perimeter"],
        }
        result["ladders"] = ladder_details
        result["length_sum"] = ladder_length_sum
        result["length_required"] = length_required

        if not inside_ok:
            result["reasons"].append("outside_redline")
        if not width_ok:
            result["reasons"].append("width_too_small")
        if not length_ok:
            result["reasons"].append("length_sum_too_short")
        if not distance_ok:
            result["reasons"].append("distance_out_of_range")

        if result["reasons"]:
            result["status"] = "fail"
            total_failed += 1
        else:
            total_passed += 1

        results.append(result)

    return {
        "status": "ok",
        "method": "pure_python",
        "summary": {
            "total_redlines": len(results),
            "passed": total_passed,
            "failed": total_failed,
            "no_buildings": total_no_buildings,
        },
        "results": results,
        "warnings": warnings,
        "parameters": {
            "building_layer": building_layer,
            "fire_ladder_layer": fire_ladder_layer,
            "redline_layer": redline_layer,
            "plot_layer": plot_layer,
            "min_width": min_width,
            "min_distance": min_distance,
            "max_distance": max_distance,
            "length_ratio": length_ratio,
        },
    }
