"""
视线通廊检测（纯 Python 实现）

包含主函数：
- check_corridor_collision: 检测视线通廊体块与建筑体块是否真实相交（贴着不算）
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
)

logger = logging.getLogger(__name__)

COLLISION_EPS = 1e-6   # 碰撞检测容差
AXIS_EPS = 1e-12       # 向量长度判零容差


def _normalize_layer_token(value: str) -> str:
    """图层名称标准化：去空格并转小写（含内部空格）"""
    return "".join(value.strip().lower().split())


def _bbox_intersects_strict(
    a: rhino3dm.BoundingBox, b: rhino3dm.BoundingBox, eps: float = 0.0
) -> bool:
    """严格判断两个 BoundingBox 是否相交（贴着不算，需真实重叠）"""
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
    """将 Mesh 的所有面分解为三角形列表（四边形面拆分为两个三角形）"""
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
    """从几何体（Mesh/Extrusion/Brep）中提取所有三角形面片"""
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
    """三维向量减法：a - b"""
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
    """三维向量点积"""
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(
    a: Tuple[float, float, float], b: Tuple[float, float, float]
) -> Tuple[float, float, float]:
    """三维向量叉积"""
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _length_sq(v: Tuple[float, float, float]) -> float:
    """三维向量长度的平方"""
    return v[0] * v[0] + v[1] * v[1] + v[2] * v[2]


def _normalize(v: Tuple[float, float, float]) -> Optional[Tuple[float, float, float]]:
    """归一化三维向量，零向量返回 None"""
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
    """将三角形三顶点投影到轴上，返回 (min, max) 区间"""
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
    """判断两个三角形在指定轴上的投影区间是否重叠（SAT 分离轴测试）"""
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
    """判断两个二维多边形在指定轴上的投影区间是否重叠（SAT 分离轴测试）"""
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
    """判断两个共面三角形是否重叠（投影到最大分量平面后用 SAT 检测）"""
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
    """判断两个三角形是否相交（使用 SAT 分离轴测试，共面时调用 2D 检测）"""
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


def _polygon_axes(polygon: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """提取多边形所有边的法向量，用于 SAT 分离轴测试"""
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
    """将多边形投影到轴上，返回 (min, max) 区间"""
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
    """严格判断两个多边形是否相交（贴着不算，使用 SAT 分离轴测试）"""
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
    """从几何体中收集所有顶点坐标，支持 Mesh/Brep/Extrusion"""
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
    """Andrew's Monotone Chain 算法计算二维凸包"""
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
    """将 BoundingBox 转换为四角二维多边形"""
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
    """提取几何体的底面轮廓凸包，失败时退化为 BoundingBox 四角"""
    points_3d = _collect_geometry_points(geometry)
    if points_3d:
        points_2d = [(x, y) for x, y, _ in points_3d]
        hull = _compute_convex_hull(points_2d)
        if len(hull) >= 3:
            return hull

    return _bbox_polygon(bbox)


def check_corridor_collision(
    model_path: Path,
    corridor_layer: str = "限制_视线通廊",
    building_layer: str = "模型_建筑体块",
    eps: float = COLLISION_EPS,
) -> Dict:
    """
    视线通廊碰撞检测主函数。
    判断通廊体块与建筑体块是否真实相交（贴着不算）。
    先用 BoundingBox 快速过滤，再用多边形相交精确判断。
    """
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"无法读取 3dm 文件: {model_path}")

    corridor_objects = _load_objects_from_layer(file3dm, corridor_layer)
    if not corridor_objects:
        # 图层名未精确匹配时，尝试模糊查找含"通廊"的图层
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
