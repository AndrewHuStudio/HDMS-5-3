"""
贴线率检测核心逻辑（纯 Python）

逻辑：
- 读取建筑体块与建筑退线图层
- 将建筑几何投影到 XY 平面形成足迹边界（凸包近似）
- 计算退线曲线与建筑足迹边界的重合长度
"""
from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import rhino3dm

logger = logging.getLogger(__name__)

Point2D = Tuple[float, float]
Segment2D = Tuple[Point2D, Point2D]


def _iter_user_strings(source: object) -> Iterable[tuple[str, Optional[str]]]:
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


def _get_user_text_from_source(source: object, key: str) -> Optional[str]:
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
    for entry_key, entry_value in _iter_user_strings(source):
        candidate = entry_key.strip()
        if not candidate:
            continue
        if candidate == normalized_key or candidate.casefold() == normalized_lower:
            if isinstance(entry_value, str) and entry_value.strip():
                return entry_value

    return None


def _get_user_text(obj: rhino3dm.File3dmObject, key: str) -> Optional[str]:
    try:
        normalized_key = key.strip()
        if not normalized_key:
            return None

        attributes = getattr(obj, "Attributes", None)
        value = _get_user_text_from_source(attributes, normalized_key)
        if value:
            return value

        geometry = getattr(obj, "Geometry", None)
        return _get_user_text_from_source(geometry, normalized_key)
    except Exception as exc:
        logger.warning("Failed to read UserText '%s': %s", key, exc)
        return None


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


def _get_bounding_box(geometry: rhino3dm.CommonObject) -> Optional[rhino3dm.BoundingBox]:
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


def _points_to_2d(points: Iterable[rhino3dm.Point3d]) -> List[Point2D]:
    return [(float(pt.X), float(pt.Y)) for pt in points]


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


def _compute_overlap_length(
    setback_points: List[Point2D],
    building_segments: List[Segment2D],
    sample_step: float,
    tolerance: float,
    closed: bool,
) -> Tuple[float, float, List[Segment2D]]:
    if len(setback_points) < 2:
        return 0.0, 0.0, []

    points = list(setback_points)
    if closed and len(points) > 2:
        points = points + [points[0]]

    total_length = _polyline_length(points)
    if total_length <= 0:
        return 0.0, 0.0, []

    step = max(sample_step, 0.05)
    tol = max(tolerance, 0.0)
    overlap = 0.0
    highlight_segments: List[Segment2D] = []

    for i in range(len(points) - 1):
        ax, ay = points[i]
        bx, by = points[i + 1]
        segment_length = math.hypot(bx - ax, by - ay)
        if segment_length <= 1e-8:
            continue

        divisions = max(1, int(math.ceil(segment_length / step)))
        sub_len = segment_length / divisions
        dx = (bx - ax) / divisions
        dy = (by - ay) / divisions

        for j in range(divisions):
            mx = ax + dx * (j + 0.5)
            my = ay + dy * (j + 0.5)
            if _min_distance_to_segments((mx, my), building_segments) <= tol:
                overlap += sub_len
                sx = ax + dx * j
                sy = ay + dy * j
                ex = ax + dx * (j + 1)
                ey = ay + dy * (j + 1)
                highlight_segments.append(((sx, sy), (ex, ey)))

    return overlap, total_length, highlight_segments


def check_setback_rate_pure_python(
    model_path: Path,
    building_layer: str = "模型_建筑体块",
    setback_layer: str = "限制_建筑退线",
    plot_layer: str = "场景_地块",
    sample_step: float = 1.0,
    tolerance: float = 0.5,
    required_rate: Optional[float] = None,
) -> Dict:
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Failed to read 3dm file: {model_path}")

    building_objects = _load_objects_from_layer(file3dm, building_layer)
    if not building_objects:
        raise ValueError(f"No buildings found in layer: {building_layer}")

    setback_objects = _load_objects_from_layer(file3dm, setback_layer)
    if not setback_objects:
        raise ValueError(f"No setbacks found in layer: {setback_layer}")

    safe_required_rate: Optional[float] = None
    if required_rate is not None:
        try:
            safe_required_rate = float(required_rate)
            if safe_required_rate > 1:
                safe_required_rate = safe_required_rate / 100.0
        except (TypeError, ValueError):
            safe_required_rate = None

    plot_objects = _load_objects_from_layer(file3dm, plot_layer)
    plot_candidates = []
    for idx, (obj, geometry) in enumerate(plot_objects):
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            continue
        name = _get_user_text(obj, "地块名称") or f"地块{idx + 1}"
        center = bbox.Center
        plot_candidates.append({
            "name": name,
            "center": center,
            "label_position": (center.X, center.Y, bbox.Max.Z + 0.2),
        })

    setback_info = []
    invalid_setbacks = 0
    open_curves = 0

    for idx, (obj, geometry) in enumerate(setback_objects):
        if not isinstance(geometry, rhino3dm.Curve):
            invalid_setbacks += 1
            continue

        if not geometry.IsClosed:
            open_curves += 1

        plot_name = _get_user_text(obj, "地块名称") or f"地块{len(setback_info) + 1}"
        points3d = _curve_to_points(geometry)
        points2d = _points_to_2d(points3d)
        if len(points2d) < 2:
            invalid_setbacks += 1
            continue
        if points3d:
            z_base = sum(pt.Z for pt in points3d) / len(points3d)
        else:
            z_base = 0.0

        label_position = None
        if plot_candidates:
            for candidate in plot_candidates:
                if _point_in_curve_2d(candidate["center"], geometry):
                    plot_name = candidate["name"]
                    label_position = candidate["label_position"]
                    break

        specific_required = None
        required_text = _get_user_text(obj, "贴线率") or _get_user_text(obj, "贴线率阈值")
        if required_text:
            try:
                value = float(required_text)
                if value > 1:
                    value = value / 100.0
                specific_required = value
            except ValueError:
                specific_required = None

        setback_info.append({
            "name": plot_name,
            "curve": geometry,
            "points2d": points2d,
            "is_closed": bool(geometry.IsClosed),
            "z_base": float(z_base),
            "label_position": label_position,
            "required_rate": specific_required,
            "building_segments": [],
            "building_count": 0,
        })

    if not setback_info:
        raise ValueError(f"No valid setback curves found in layer: {setback_layer}")

    unmatched_buildings = 0
    total_buildings = 0
    for idx, (obj, geometry) in enumerate(building_objects):
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            continue
        total_buildings += 1
        center = bbox.Center

        segments = _bottom_edge_segments(geometry)

        matched_plot = None
        for plot in setback_info:
            if plot["curve"].IsClosed and _point_in_curve_2d(center, plot["curve"]):
                matched_plot = plot
                break

        if matched_plot is None:
            unmatched_buildings += 1
            continue

        if segments:
            matched_plot["building_segments"].extend(segments)
        matched_plot["building_count"] += 1

    plots = []
    total_setback_length = 0.0
    total_overlap_length = 0.0

    for plot in setback_info:
        overlap, length, highlight_segments_2d = _compute_overlap_length(
            plot["points2d"],
            plot["building_segments"],
            sample_step,
            tolerance,
            plot["is_closed"],
        )
        total_setback_length += length
        total_overlap_length += overlap
        rate = overlap / length if length > 0 else 0.0

        required = safe_required_rate
        if required is None:
            required = plot.get("required_rate")

        is_compliant = None
        if required is not None:
            is_compliant = rate >= required

        highlight_segments = [
            [
                [segment[0][0], segment[0][1], plot["z_base"]],
                [segment[1][0], segment[1][1], plot["z_base"]],
            ]
            for segment in highlight_segments_2d
        ]

        outline_points = [
            [float(pt.X), float(pt.Y), float(pt.Z)]
            for pt in _curve_to_points(plot["curve"])
        ]

        label_position = plot.get("label_position")
        if label_position is None:
            if plot["points2d"]:
                avg_x = sum(p[0] for p in plot["points2d"]) / len(plot["points2d"])
                avg_y = sum(p[1] for p in plot["points2d"]) / len(plot["points2d"])
                label_position = (avg_x, avg_y, plot["z_base"] + 0.2)
            else:
                label_position = (0.0, 0.0, plot["z_base"] + 0.2)

        plots.append({
            "plot_name": plot["name"],
            "setback_length": length,
            "overlap_length": overlap,
            "frontage_rate": rate,
            "required_rate": required,
            "is_compliant": is_compliant,
            "building_count": plot["building_count"],
            "highlight_segments": highlight_segments,
            "outline_points": outline_points,
            "label_position": [float(label_position[0]), float(label_position[1]), float(label_position[2])],
        })

    overall_rate = total_overlap_length / total_setback_length if total_setback_length > 0 else 0.0

    warnings: List[str] = []
    if unmatched_buildings > 0:
        warnings.append(f"{unmatched_buildings} buildings are not within any setback boundary")
    if invalid_setbacks > 0:
        warnings.append(f"{invalid_setbacks} setback objects are not valid curves")
    if open_curves > 0:
        warnings.append(f"{open_curves} setback curves are not closed; plot matching may be incomplete")

    return {
        "status": "ok",
        "method": "pure_python",
        "summary": {
            "total_plots": len(plots),
            "total_buildings": total_buildings,
            "total_setback_length": total_setback_length,
            "total_overlap_length": total_overlap_length,
            "overall_rate": overall_rate,
            "unmatched_buildings": unmatched_buildings,
        },
        "plots": plots,
        "warnings": warnings,
        "parameters": {
            "building_layer": building_layer,
            "setback_layer": setback_layer,
            "plot_layer": plot_layer,
            "sample_step": sample_step,
            "tolerance": tolerance,
            "required_rate": safe_required_rate,
        },
    }
