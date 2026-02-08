"""
视线通廊检测核心逻辑
基于射线追踪的可见性分析
"""
from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import List, Dict, Tuple, Optional

import rhino3dm
from core.utils import (
    get_bounding_box as _get_bounding_box,
    get_user_text as _get_user_text,
    get_user_text_from_source as _get_user_text_from_source,
)

logger = logging.getLogger(__name__)

COLLISION_EPS = 1e-6
AXIS_EPS = 1e-12
ANGLE_EPS = 1e-9


def _normalize_layer_token(value: str) -> str:
    return "".join(value.strip().lower().split())


def _bbox_intersects_strict(
    a: rhino3dm.BoundingBox, b: rhino3dm.BoundingBox, eps: float = 0.0
) -> bool:
    return (
        a.Max.X > b.Min.X + eps
        and a.Min.X < b.Max.X - eps
        and a.Max.Y > b.Min.Y + eps
        and a.Min.Y < b.Max.Y - eps
        and a.Max.Z > b.Min.Z + eps
        and a.Min.Z < b.Max.Z - eps
    )


def _mesh_triangles_from_mesh(
    mesh: rhino3dm.Mesh,
) -> List[Tuple[Tuple[float, float, float], Tuple[float, float, float], Tuple[float, float, float]]]:
    triangles: List[Tuple[Tuple[float, float, float], Tuple[float, float, float], Tuple[float, float, float]]] = []
    faces = mesh.Faces
    vertices = mesh.Vertices
    face_count = getattr(faces, "Count", 0) or 0

    for i in range(face_count):
        indices = faces.GetFaceVertices(i)
        if not indices or len(indices) < 3:
            continue
        a, b, c = indices[0], indices[1], indices[2]
        d = indices[3] if len(indices) > 3 else c

        try:
            pa = vertices[a]
            pb = vertices[b]
            pc = vertices[c]
        except Exception:
            continue

        triangles.append(((pa.X, pa.Y, pa.Z), (pb.X, pb.Y, pb.Z), (pc.X, pc.Y, pc.Z)))

        if len(indices) > 3 and d is not None and d != c and d >= 0:
            try:
                pd = vertices[d]
            except Exception:
                continue
            triangles.append(((pa.X, pa.Y, pa.Z), (pc.X, pc.Y, pc.Z), (pd.X, pd.Y, pd.Z)))

    return triangles


def _mesh_triangles_from_geometry(
    geometry: rhino3dm.CommonObject,
) -> List[Tuple[Tuple[float, float, float], Tuple[float, float, float], Tuple[float, float, float]]]:
    if isinstance(geometry, rhino3dm.Mesh):
        return _mesh_triangles_from_mesh(geometry)

    if isinstance(geometry, rhino3dm.Extrusion):
        try:
            brep = geometry.ToBrep(True)
        except TypeError:
            brep = geometry.ToBrep()
        if brep is not None:
            return _mesh_triangles_from_geometry(brep)

    if isinstance(geometry, rhino3dm.Brep):
        meshes: List[rhino3dm.Mesh] = []
        for face in geometry.Faces:
            mesh = None
            for mesh_type in (
                rhino3dm.MeshType.Render,
                rhino3dm.MeshType.Any,
                rhino3dm.MeshType.Default,
                rhino3dm.MeshType.Preview,
                rhino3dm.MeshType.Analysis,
            ):
                try:
                    mesh = face.GetMesh(mesh_type)
                except Exception:
                    mesh = None
                if mesh is not None:
                    break
            if mesh is not None:
                meshes.append(mesh)

        triangles: List[Tuple[Tuple[float, float, float], Tuple[float, float, float], Tuple[float, float, float]]] = []
        for mesh in meshes:
            triangles.extend(_mesh_triangles_from_mesh(mesh))
        return triangles

    return []


def _vec_sub(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> Tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(
    a: Tuple[float, float, float], b: Tuple[float, float, float]
) -> Tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _length_sq(v: Tuple[float, float, float]) -> float:
    return v[0] * v[0] + v[1] * v[1] + v[2] * v[2]


def _normalize(v: Tuple[float, float, float]) -> Optional[Tuple[float, float, float]]:
    length_sq = _length_sq(v)
    if length_sq <= AXIS_EPS:
        return None
    inv = 1.0 / math.sqrt(length_sq)
    return (v[0] * inv, v[1] * inv, v[2] * inv)


def _project_triangle(
    axis: Tuple[float, float, float],
    a: Tuple[float, float, float],
    b: Tuple[float, float, float],
    c: Tuple[float, float, float],
) -> Tuple[float, float]:
    p0 = _dot(axis, a)
    p1 = _dot(axis, b)
    p2 = _dot(axis, c)
    return (min(p0, p1, p2), max(p0, p1, p2))


def _overlap_on_axis(
    axis: Tuple[float, float, float],
    a0: Tuple[float, float, float],
    a1: Tuple[float, float, float],
    a2: Tuple[float, float, float],
    b0: Tuple[float, float, float],
    b1: Tuple[float, float, float],
    b2: Tuple[float, float, float],
    eps: float,
) -> bool:
    a_min, a_max = _project_triangle(axis, a0, a1, a2)
    b_min, b_max = _project_triangle(axis, b0, b1, b2)
    if a_max <= b_min + eps or b_max <= a_min + eps:
        return False
    return True


def _overlap_on_axis_2d(
    axis: Tuple[float, float],
    tri_a: List[Tuple[float, float]],
    tri_b: List[Tuple[float, float]],
    eps: float,
) -> bool:
    ax, ay = axis
    min_a = ax * tri_a[0][0] + ay * tri_a[0][1]
    max_a = min_a
    for i in range(1, len(tri_a)):
        value = ax * tri_a[i][0] + ay * tri_a[i][1]
        min_a = min(min_a, value)
        max_a = max(max_a, value)

    min_b = ax * tri_b[0][0] + ay * tri_b[0][1]
    max_b = min_b
    for i in range(1, len(tri_b)):
        value = ax * tri_b[i][0] + ay * tri_b[i][1]
        min_b = min(min_b, value)
        max_b = max(max_b, value)

    if max_a <= min_b + eps or max_b <= min_a + eps:
        return False
    return True


def _triangles_overlap_coplanar(
    a0: Tuple[float, float, float],
    a1: Tuple[float, float, float],
    a2: Tuple[float, float, float],
    b0: Tuple[float, float, float],
    b1: Tuple[float, float, float],
    b2: Tuple[float, float, float],
    normal: Tuple[float, float, float],
    eps: float,
) -> bool:
    abs_x = abs(normal[0])
    abs_y = abs(normal[1])
    abs_z = abs(normal[2])
    drop_axis = "z"
    if abs_x >= abs_y and abs_x >= abs_z:
        drop_axis = "x"
    elif abs_y >= abs_x and abs_y >= abs_z:
        drop_axis = "y"

    def to_2d(v: Tuple[float, float, float]) -> Tuple[float, float]:
        if drop_axis == "x":
            return (v[1], v[2])
        if drop_axis == "y":
            return (v[0], v[2])
        return (v[0], v[1])

    tri_a = [to_2d(a0), to_2d(a1), to_2d(a2)]
    tri_b = [to_2d(b0), to_2d(b1), to_2d(b2)]

    edges = [
        (tri_a[0], tri_a[1]),
        (tri_a[1], tri_a[2]),
        (tri_a[2], tri_a[0]),
        (tri_b[0], tri_b[1]),
        (tri_b[1], tri_b[2]),
        (tri_b[2], tri_b[0]),
    ]

    for p0, p1 in edges:
        dx = p1[0] - p0[0]
        dy = p1[1] - p0[1]
        length = math.hypot(dx, dy)
        if length <= AXIS_EPS:
            continue
        axis = (-dy / length, dx / length)
        if not _overlap_on_axis_2d(axis, tri_a, tri_b, eps):
            return False

    return True


def _triangles_intersect(
    a0: Tuple[float, float, float],
    a1: Tuple[float, float, float],
    a2: Tuple[float, float, float],
    b0: Tuple[float, float, float],
    b1: Tuple[float, float, float],
    b2: Tuple[float, float, float],
    eps: float,
) -> bool:
    a0a1 = _vec_sub(a1, a0)
    a1a2 = _vec_sub(a2, a1)
    a2a0 = _vec_sub(a0, a2)
    b0b1 = _vec_sub(b1, b0)
    b1b2 = _vec_sub(b2, b1)
    b2b0 = _vec_sub(b0, b2)

    n1 = _cross(a0a1, a1a2)
    n2 = _cross(b0b1, b1b2)
    n1_len_sq = _length_sq(n1)
    n2_len_sq = _length_sq(n2)
    if n1_len_sq <= AXIS_EPS or n2_len_sq <= AXIS_EPS:
        return False

    n1n = _normalize(n1)
    n2n = _normalize(n2)
    if n1n is None or n2n is None:
        return False

    normal_cross = _cross(n1n, n2n)
    if _length_sq(normal_cross) <= AXIS_EPS:
        plane_offset = abs(_dot(n1n, _vec_sub(b0, a0)))
        if plane_offset <= eps:
            return _triangles_overlap_coplanar(a0, a1, a2, b0, b1, b2, n1n, eps)

    if not _overlap_on_axis(n1n, a0, a1, a2, b0, b1, b2, eps):
        return False
    if not _overlap_on_axis(n2n, a0, a1, a2, b0, b1, b2, eps):
        return False

    edges_a = [a0a1, a1a2, a2a0]
    edges_b = [b0b1, b1b2, b2b0]

    for edge_a in edges_a:
        for edge_b in edges_b:
            axis = _cross(edge_a, edge_b)
            axis_n = _normalize(axis)
            if axis_n is None:
                continue
            if not _overlap_on_axis(axis_n, a0, a1, a2, b0, b1, b2, eps):
                return False

    return True


def _load_objects_from_layer(
    file3dm: rhino3dm.File3dm, layer_name: str
) -> List[
    Tuple[
        rhino3dm.File3dmObject,
        rhino3dm.CommonObject,
        rhino3dm.Layer,
        int,
        str,
    ]
]:
    """从指定图层加载所有对象"""
    target_layer = _normalize_layer_token(layer_name)

    if not target_layer:
        return []

    layer_by_index: Dict[int, Tuple[set[str], str, rhino3dm.Layer]] = {}
    for i, layer in enumerate(file3dm.Layers):
        layer_index = getattr(layer, "Index", None) or getattr(layer, "index", None) or i

        layer_full_path = None
        for attr in ("FullPath", "fullPath", "Name", "name"):
            value = getattr(layer, attr, None)
            if callable(value):
                try:
                    value = value()
                except TypeError:
                    value = None
            if isinstance(value, str) and value.strip():
                layer_full_path = value
                break

        if layer_full_path:
            normalized_full = _normalize_layer_token(layer_full_path)
            candidates = {normalized_full}
            if "::" in layer_full_path:
                parts = [
                    _normalize_layer_token(part)
                    for part in layer_full_path.split("::")
                    if part.strip()
                ]
                candidates.update(part for part in parts if part)
            layer_by_index[layer_index] = (candidates, layer_full_path.strip(), layer)

    def is_target_layer(layer_candidates: set[str]) -> bool:
        if target_layer in layer_candidates:
            return True
        for candidate in layer_candidates:
            if candidate.startswith(f"{target_layer}::"):
                return True
        return False

    objects = []
    for obj in file3dm.Objects:
        geometry = obj.Geometry
        if geometry is None:
            continue

        attributes = getattr(obj, "Attributes", None)
        layer_index = getattr(attributes, "LayerIndex", None) if attributes else None

        if layer_index is None:
            continue

        layer_entry = layer_by_index.get(layer_index)
        if not layer_entry:
            continue

        layer_candidates, layer_full_path, layer = layer_entry
        if is_target_layer(layer_candidates):
            objects.append((obj, geometry, layer, layer_index, layer_full_path))

    return objects


def _ray_box_intersection(
    ray_origin: Tuple[float, float, float],
    ray_direction: Tuple[float, float, float],
    bbox: rhino3dm.BoundingBox,
) -> Optional[float]:
    """
    射线与BoundingBox相交检测（简化版）
    返回交点距离，如果不相交返回None

    使用Slab方法：https://tavianator.com/2011/ray_box.html
    """
    ox, oy, oz = ray_origin
    dx, dy, dz = ray_direction

    # 归一化方向向量
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    if length < 1e-10:
        return None
    dx, dy, dz = dx / length, dy / length, dz / length

    # BoundingBox的最小和最大点
    min_x, min_y, min_z = bbox.Min.X, bbox.Min.Y, bbox.Min.Z
    max_x, max_y, max_z = bbox.Max.X, bbox.Max.Y, bbox.Max.Z

    # 计算与各个平面的交点参数t
    def compute_t(o, d, box_min, box_max):
        if abs(d) < 1e-10:
            # 射线平行于该轴
            if o < box_min or o > box_max:
                return None, None
            return -float('inf'), float('inf')

        t1 = (box_min - o) / d
        t2 = (box_max - o) / d
        return (t1, t2) if t1 < t2 else (t2, t1)

    tx = compute_t(ox, dx, min_x, max_x)
    ty = compute_t(oy, dy, min_y, max_y)
    tz = compute_t(oz, dz, min_z, max_z)

    if tx is None or ty is None or tz is None:
        return None

    # 计算进入和离开的t值
    t_min = max(tx[0], ty[0], tz[0])
    t_max = min(tx[1], ty[1], tz[1])

    # 检查是否相交
    if t_max < t_min or t_max < 0:
        return None

    # 返回最近的交点距离（如果t_min < 0说明射线起点在box内）
    return t_min if t_min > 0 else t_max


def _horizontal_distance_to_bbox(
    ox: float, oy: float, bbox: rhino3dm.BoundingBox
) -> float:
    """计算观察点到建筑包围盒在水平面的最近距离"""
    min_x, min_y = bbox.Min.X, bbox.Min.Y
    max_x, max_y = bbox.Max.X, bbox.Max.Y

    dx = 0.0
    if ox < min_x:
        dx = min_x - ox
    elif ox > max_x:
        dx = ox - max_x

    dy = 0.0
    if oy < min_y:
        dy = min_y - oy
    elif oy > max_y:
        dy = oy - max_y

    return math.sqrt(dx * dx + dy * dy)


def _sample_bbox_points_2d(bbox: rhino3dm.BoundingBox) -> List[Tuple[float, float]]:
    """从建筑包围盒投影采样多个点用于2D可见性判断"""
    min_x, min_y, min_z = bbox.Min.X, bbox.Min.Y, bbox.Min.Z
    max_x, max_y, max_z = bbox.Max.X, bbox.Max.Y, bbox.Max.Z

    mid_x = (min_x + max_x) / 2
    mid_y = (min_y + max_y) / 2
    mid_z = (min_z + max_z) / 2

    return [
        (min_x, min_y),
        (min_x, max_y),
        (max_x, min_y),
        (max_x, max_y),
        (mid_x, min_y),
        (mid_x, max_y),
        (min_x, mid_y),
        (max_x, mid_y),
        (mid_x, mid_y),
    ]


def _cross_2d(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return a[0] * b[1] - a[1] * b[0]


def _segment_intersection_t(
    p1: Tuple[float, float],
    p2: Tuple[float, float],
    q1: Tuple[float, float],
    q2: Tuple[float, float],
    epsilon: float = 1e-9,
) -> Optional[float]:
    """返回线段p1->p2与q1->q2的交点在p段上的t参数"""
    r = (p2[0] - p1[0], p2[1] - p1[1])
    s = (q2[0] - q1[0], q2[1] - q1[1])
    rxs = _cross_2d(r, s)
    qp = (q1[0] - p1[0], q1[1] - p1[1])

    if abs(rxs) < epsilon:
        return None

    t = _cross_2d(qp, s) / rxs
    u = _cross_2d(qp, r) / rxs

    if -epsilon <= t <= 1 + epsilon and -epsilon <= u <= 1 + epsilon:
        return max(0.0, min(1.0, t))
    return None


def _ray_segment_intersection_t(
    origin: Tuple[float, float],
    direction: Tuple[float, float],
    a: Tuple[float, float],
    b: Tuple[float, float],
    epsilon: float = 1e-9,
) -> Optional[float]:
    """返回射线与线段的交点在射线方向上的t参数（t>=0）。"""
    r = direction
    s = (b[0] - a[0], b[1] - a[1])
    rxs = _cross_2d(r, s)
    if abs(rxs) < epsilon:
        return None

    qp = (a[0] - origin[0], a[1] - origin[1])
    t = _cross_2d(qp, s) / rxs
    u = _cross_2d(qp, r) / rxs

    if t >= -epsilon and -epsilon <= u <= 1 + epsilon:
        return max(0.0, t)
    return None


def _ray_polygon_entry_t(
    origin: Tuple[float, float],
    direction: Tuple[float, float],
    polygon: List[Tuple[float, float]],
) -> Optional[float]:
    """计算射线进入多边形边界的最小t"""
    if len(polygon) < 3:
        return None
    if _point_in_polygon(origin, polygon):
        return 0.0

    min_t: Optional[float] = None
    for i in range(len(polygon)):
        a = polygon[i]
        b = polygon[(i + 1) % len(polygon)]
        t = _ray_segment_intersection_t(origin, direction, a, b)
        if t is None:
            continue
        if min_t is None or t < min_t:
            min_t = t
    return min_t


def _normalize_angle(angle: float) -> float:
    value = angle % (2 * math.pi)
    if value < 0:
        value += 2 * math.pi
    return value


def _angle_in_interval(angle: float, start: float, end: float, eps: float = ANGLE_EPS) -> bool:
    if start <= end:
        return start - eps <= angle <= end + eps
    return angle >= start - eps or angle <= end + eps


def _polygon_angle_intervals(
    origin: Tuple[float, float],
    polygon: List[Tuple[float, float]],
) -> List[Tuple[float, float]]:
    if len(polygon) < 3:
        return []
    if _point_in_polygon(origin, polygon):
        return [(0.0, 2 * math.pi)]

    angles = []
    for x, y in polygon:
        angles.append(_normalize_angle(math.atan2(y - origin[1], x - origin[0])))
    angles = sorted(set(angles))
    if len(angles) < 2:
        if angles:
            return [(angles[0], angles[0])]
        return []

    max_gap = -1.0
    max_gap_index = 0
    for i in range(len(angles)):
        a = angles[i]
        b = angles[(i + 1) % len(angles)]
        gap = (b - a) if i < len(angles) - 1 else (angles[0] + 2 * math.pi - angles[-1])
        if gap > max_gap:
            max_gap = gap
            max_gap_index = i

    start = angles[(max_gap_index + 1) % len(angles)]
    end = angles[max_gap_index]
    if start <= end:
        return [(start, end)]
    return [(start, 2 * math.pi), (0.0, end)]


def _polygon_entry_t(
    start: Tuple[float, float],
    end: Tuple[float, float],
    polygon: List[Tuple[float, float]],
) -> Optional[float]:
    """计算线段进入多边形边界的最小t"""
    if len(polygon) < 2:
        return None

    min_t: Optional[float] = None
    for i in range(len(polygon)):
        a = polygon[i]
        b = polygon[(i + 1) % len(polygon)]
        t = _segment_intersection_t(start, end, a, b)
        if t is None:
            continue
        if min_t is None or t < min_t:
            min_t = t
    return min_t


def _point_in_polygon(point: Tuple[float, float], polygon: List[Tuple[float, float]]) -> bool:
    if len(polygon) < 3:
        return False
    x, y = point
    inside = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def _distance_point_to_segment(
    point: Tuple[float, float],
    a: Tuple[float, float],
    b: Tuple[float, float],
) -> float:
    px, py = point
    ax, ay = a
    bx, by = b
    dx = bx - ax
    dy = by - ay
    if dx == 0 and dy == 0:
        return math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    closest_x = ax + t * dx
    closest_y = ay + t * dy
    return math.sqrt((px - closest_x) ** 2 + (py - closest_y) ** 2)


def _polygon_intersects_circle(
    polygon: List[Tuple[float, float]],
    center: Tuple[float, float],
    radius: float,
) -> bool:
    if len(polygon) < 3:
        return False

    cx, cy = center
    radius_sq = radius * radius

    for x, y in polygon:
        if (x - cx) ** 2 + (y - cy) ** 2 <= radius_sq:
            return True

    if _point_in_polygon(center, polygon):
        return True

    for i in range(len(polygon)):
        a = polygon[i]
        b = polygon[(i + 1) % len(polygon)]
        if _distance_point_to_segment(center, a, b) <= radius:
            return True

    return False


def _polygon_axes(polygon: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    axes: List[Tuple[float, float]] = []
    if len(polygon) < 2:
        return axes

    for i in range(len(polygon)):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % len(polygon)]
        dx = x2 - x1
        dy = y2 - y1
        length = math.hypot(dx, dy)
        if length <= AXIS_EPS:
            continue
        axis = (-dy / length, dx / length)
        axes.append(axis)
    return axes


def _project_polygon(
    axis: Tuple[float, float],
    polygon: List[Tuple[float, float]],
) -> Tuple[float, float]:
    ax, ay = axis
    min_p = ax * polygon[0][0] + ay * polygon[0][1]
    max_p = min_p
    for i in range(1, len(polygon)):
        value = ax * polygon[i][0] + ay * polygon[i][1]
        min_p = min(min_p, value)
        max_p = max(max_p, value)
    return min_p, max_p


def _polygons_intersect_strict(
    poly_a: List[Tuple[float, float]],
    poly_b: List[Tuple[float, float]],
    eps: float,
) -> bool:
    if len(poly_a) < 3 or len(poly_b) < 3:
        return False

    axes = _polygon_axes(poly_a) + _polygon_axes(poly_b)
    for axis in axes:
        min_a, max_a = _project_polygon(axis, poly_a)
        min_b, max_b = _project_polygon(axis, poly_b)
        if max_a <= min_b + eps or max_b <= min_a + eps:
            return False
    return True


def _collect_geometry_points(geometry: rhino3dm.CommonObject) -> List[Tuple[float, float, float]]:
    points: List[Tuple[float, float, float]] = []

    if isinstance(geometry, rhino3dm.Mesh):
        try:
            for v in geometry.Vertices:
                points.append((v.X, v.Y, v.Z))
            return points
        except Exception:
            pass

    if isinstance(geometry, rhino3dm.Brep):
        try:
            for v in geometry.Vertices:
                loc = getattr(v, "Location", None)
                if loc is not None:
                    points.append((loc.X, loc.Y, loc.Z))
            return points
        except Exception:
            pass

    if isinstance(geometry, rhino3dm.Extrusion):
        try:
            brep = geometry.ToBrep(True)
        except TypeError:
            brep = geometry.ToBrep()
        if brep is not None:
            return _collect_geometry_points(brep)

    return points


def _compute_convex_hull(points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    if len(points) < 3:
        return points

    points = sorted(set(points))
    if len(points) < 3:
        return points

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    upper = []
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    lower.pop()
    upper.pop()
    return lower + upper


def _bbox_polygon(bbox: rhino3dm.BoundingBox) -> List[Tuple[float, float]]:
    min_x, min_y = bbox.Min.X, bbox.Min.Y
    max_x, max_y = bbox.Max.X, bbox.Max.Y
    return [
        (min_x, min_y),
        (max_x, min_y),
        (max_x, max_y),
        (min_x, max_y),
    ]


def _extract_footprint_polygon(
    geometry: rhino3dm.CommonObject,
    bbox: rhino3dm.BoundingBox,
) -> List[Tuple[float, float]]:
    points_3d = _collect_geometry_points(geometry)
    if points_3d:
        points_2d = [(x, y) for x, y, _ in points_3d]
        hull = _compute_convex_hull(points_2d)
        if len(hull) >= 3:
            return hull

    return _bbox_polygon(bbox)


def _sample_polygon_points(polygon: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    if len(polygon) < 3:
        return polygon

    points = list(polygon)
    for i in range(len(polygon)):
        a = polygon[i]
        b = polygon[(i + 1) % len(polygon)]
        points.append(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))

    return points


def _segment_intersects_rect(
    start: Tuple[float, float],
    end: Tuple[float, float],
    bbox: rhino3dm.BoundingBox,
    epsilon: float = 1e-9,
) -> Optional[Tuple[float, float]]:
    """二维线段与矩形相交检测，返回进入/离开参数t范围"""
    min_x, min_y = bbox.Min.X, bbox.Min.Y
    max_x, max_y = bbox.Max.X, bbox.Max.Y

    x0, y0 = start
    x1, y1 = end
    dx = x1 - x0
    dy = y1 - y0

    u1 = 0.0
    u2 = 1.0

    for p, q in (
        (-dx, x0 - min_x),
        (dx, max_x - x0),
        (-dy, y0 - min_y),
        (dy, max_y - y0),
    ):
        if abs(p) < epsilon:
            if q < 0:
                return None
            continue

        t = q / p
        if p < 0:
            if t > u2:
                return None
            if t > u1:
                u1 = t
        else:
            if t < u1:
                return None
            if t < u2:
                u2 = t

        if u1 > u2:
            return None

    return (u1, u2)


def check_sight_corridor(
    model_path: Path,
    building_layer: str = "模型_建筑体块",
    observer_position: Tuple[float, float, float] = (0, 0, 1.5),
    hemisphere_radius: float = 100.0,
) -> Dict:
    """
    视线通廊检测 - 计算观察点的可见建筑

    Args:
        model_path: 3dm模型文件路径
        building_layer: 建筑体块图层名称
        observer_position: 观察者位置 (x, y, z)
        hemisphere_radius: 可视半球半径（米）

    Returns:
        检测结果字典
    """
    # 读取模型
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Failed to read 3dm file: {model_path}")

    # 加载建筑体块
    building_objects = _load_objects_from_layer(file3dm, building_layer)
    if not building_objects:
        raise ValueError(f"No buildings found in layer: {building_layer}")

    logger.info(f"Loaded {len(building_objects)} buildings from layer '{building_layer}'")

    # 解析建筑信息
    buildings = []
    for idx, (obj, geometry, layer, layer_index, layer_full_path) in enumerate(building_objects):
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            logger.warning(f"Building {idx} has no valid bounding box, skipping")
            continue

        # 读取建筑名称
        layer_user_name = _get_user_text_from_source(layer, "建筑名称")
        building_name = (
            _get_user_text(obj, "建筑名称")
            or layer_user_name
            or layer_full_path
            or f"建筑{idx + 1}"
        )

        # 计算建筑中心点
        center = bbox.Center

        buildings.append({
            "index": idx,
            "name": building_name,
            "layer_index": layer_index,
            "layer_name": layer_full_path,
            "bbox": bbox,
            "footprint": _extract_footprint_polygon(geometry, bbox),
            "center": (center.X, center.Y, center.Z),
            "geometry": geometry,
        })

    logger.info(f"Parsed {len(buildings)} valid buildings")

    # 观察者位置
    obs_x, obs_y, obs_z = observer_position

    # 计算每个建筑的可见性
    visible_buildings = []
    invisible_buildings = []
    blocking_buildings = {}

    visible_indices: set[int] = set()
    blocker_indices: set[int] = set()

    origin = (obs_x, obs_y)

    building_intervals: Dict[int, List[Tuple[float, float]]] = {}
    event_angles: List[float] = []

    for building in buildings:
        intervals = _polygon_angle_intervals(origin, building["footprint"])
        building_intervals[building["index"]] = intervals
        for start, end in intervals:
            event_angles.append(start)
            event_angles.append(end)

    if not event_angles:
        event_angles = [0.0, 2 * math.pi]

    event_angles = sorted(set(_normalize_angle(a) for a in event_angles))

    for i in range(len(event_angles)):
        start = event_angles[i]
        end = event_angles[(i + 1) % len(event_angles)]
        span = end - start if i < len(event_angles) - 1 else (end + 2 * math.pi - start)
        if span <= ANGLE_EPS:
            continue
        mid = _normalize_angle(start + span / 2.0)
        direction = (math.cos(mid), math.sin(mid))

        candidates: List[Tuple[float, Dict]] = []
        for building in buildings:
            intervals = building_intervals.get(building["index"], [])
            if not intervals:
                continue
            if not any(_angle_in_interval(mid, a, b) for a, b in intervals):
                continue
            entry_t = _ray_polygon_entry_t(origin, direction, building["footprint"])
            if entry_t is None:
                continue
            candidates.append((entry_t, building))

        if not candidates:
            continue

        candidates.sort(key=lambda x: x[0])
        nearest_t = candidates[0][0]
        for entry_t, building in candidates:
            if abs(entry_t - nearest_t) <= 1e-6:
                visible_indices.add(building["index"])
            else:
                break
        if len(candidates) > 1:
            blocker_indices.add(candidates[0][1]["index"])

    for building in buildings:
        if building["index"] in visible_indices:
            visible_buildings.append({
                "building_name": building["name"],
                "distance": _horizontal_distance_to_bbox(obs_x, obs_y, building["bbox"]),
                "is_visible": True,
                "layer_index": building.get("layer_index"),
                "layer_name": building.get("layer_name"),
            })
        else:
            invisible_buildings.append({
                "building_name": building["name"],
                "distance": _horizontal_distance_to_bbox(obs_x, obs_y, building["bbox"]),
                "is_visible": False,
                "reason": "被遮挡",
                "layer_index": building.get("layer_index"),
                "layer_name": building.get("layer_name"),
            })

    for building in buildings:
        if building["index"] in blocker_indices:
            blocker_name = building.get("name")
            if blocker_name:
                blocking_buildings[blocker_name] = {
                    "building_name": blocker_name,
                    "layer_index": building.get("layer_index"),
                    "layer_name": building.get("layer_name"),
                }

    # 计算最远可见距离
    max_visible_distance = 0.0
    if visible_buildings:
        max_visible_distance = max(b["distance"] for b in visible_buildings)

    # 按距离排序
    visible_buildings.sort(key=lambda x: x["distance"])
    invisible_buildings.sort(key=lambda x: x["distance"])

    return {
        "status": "ok",
        "max_visible_distance": max_visible_distance,
        "visible_buildings": visible_buildings,
        "invisible_buildings": invisible_buildings,
        "blocking_buildings": list(blocking_buildings.values()),
        "hemisphere_radius": hemisphere_radius,
        "observer_position": {
            "x": obs_x,
            "y": obs_y,
            "z": obs_z,
        },
        "summary": {
            "total_buildings": len(buildings),
            "visible_count": len(visible_buildings),
            "invisible_count": len(invisible_buildings),
        },
    }


def check_corridor_collision(
    model_path: Path,
    corridor_layer: str = "限制_视线通廊",
    building_layer: str = "模型_建筑体块",
    eps: float = COLLISION_EPS,
) -> Dict:
    """
    视线通廊碰撞检测 - 判断通廊与建筑是否真实相交（贴着不算）
    """
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Failed to read 3dm file: {model_path}")

    corridor_objects = _load_objects_from_layer(file3dm, corridor_layer)
    if not corridor_objects:
        candidate_layers: List[str] = []
        for layer in file3dm.Layers:
            layer_full_path = None
            for attr in ("FullPath", "fullPath", "Name", "name"):
                value = getattr(layer, attr, None)
                if callable(value):
                    try:
                        value = value()
                    except TypeError:
                        value = None
                if isinstance(value, str) and value.strip():
                    layer_full_path = value.strip()
                    break
            if not layer_full_path:
                continue
            normalized = _normalize_layer_token(layer_full_path)
            if "通廊" in normalized:
                candidate_layers.append(layer_full_path)

        if len(candidate_layers) == 1:
            corridor_objects = _load_objects_from_layer(file3dm, candidate_layers[0])
    if not corridor_objects:
        return {"status": "missing_corridor", "blocked_buildings": []}

    building_objects = _load_objects_from_layer(file3dm, building_layer)
    if not building_objects:
        return {"status": "missing_buildings", "blocked_buildings": []}

    corridor_sets = []
    for obj, geometry, layer, layer_index, layer_full_path in corridor_objects:
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            continue
        footprint = _extract_footprint_polygon(geometry, bbox)
        corridor_sets.append({"bbox": bbox, "footprint": footprint})

    if not corridor_sets:
        return {"status": "missing_corridor", "blocked_buildings": []}

    blocked_buildings = []
    for idx, (obj, geometry, layer, layer_index, layer_full_path) in enumerate(building_objects):
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            continue

        should_check = False
        for corridor in corridor_sets:
            if _bbox_intersects_strict(corridor["bbox"], bbox, eps):
                should_check = True
                break
        if not should_check:
            continue

        footprint = _extract_footprint_polygon(geometry, bbox)
        if len(footprint) < 3:
            continue

        is_blocked = False
        for corridor in corridor_sets:
            if not _bbox_intersects_strict(corridor["bbox"], bbox, eps):
                continue
            corridor_footprint = corridor["footprint"]
            if len(corridor_footprint) < 3:
                continue
            if _polygons_intersect_strict(corridor_footprint, footprint, eps):
                is_blocked = True
                break

        if is_blocked:
            object_name = None
            attributes = getattr(obj, "Attributes", None)
            if attributes is not None:
                value = getattr(attributes, "Name", None) or getattr(attributes, "name", None)
                if callable(value):
                    try:
                        value = value()
                    except Exception:
                        value = None
                if isinstance(value, str) and value.strip():
                    object_name = value.strip()

            if not object_name:
                value = getattr(obj, "Name", None) or getattr(obj, "name", None)
                if callable(value):
                    try:
                        value = value()
                    except Exception:
                        value = None
                if isinstance(value, str) and value.strip():
                    object_name = value.strip()

            building_name = _get_user_text(obj, "建筑名称") or object_name or f"对象 {idx + 1}"
            blocked_buildings.append({
                "building_name": building_name,
                "layer_index": layer_index,
                "layer_name": layer_full_path,
            })

    return {
        "status": "blocked" if blocked_buildings else "clear",
        "blocked_buildings": blocked_buildings,
    }
