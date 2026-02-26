"""
绿地退线违规检测（纯 Python 实现）

检测建筑体块是否侵入绿地退线范围。
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
    """
    图层名称标准化：去首尾空格并转小写。

    Args:
        name: 原始图层名称字符串。

    Returns:
        标准化后的名称，用于大小写不敏感的图层匹配。
    """
    return name.strip().lower()


def _expand_layer_name(name: str) -> set[str]:
    """
    将图层名展开为候选集合，同时包含完整路径和末级名称。

    Rhino 图层支持嵌套路径（如 "父层::子层"），此函数将完整路径和
    末级名称都加入候选集，以便在匹配时兼容两种写法。

    Args:
        name: 原始图层名称（可含 "::" 分隔符）。

    Returns:
        标准化后的候选名称集合。
    """
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
    """
    获取图层的所有候选名称，兼容 FullPath / Name 等不同属性名。

    rhino3dm 不同版本对图层名称的属性名不一致，此函数依次尝试
    FullPath、fullPath、Name、name，返回所有非空的名称列表。

    Args:
        layer: Rhino 图层对象。

    Returns:
        该图层的所有可用名称字符串列表（去除空值）。
    """
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
    """
    从 File3dm 中按图层名加载所有对象，返回 (对象, 几何体) 列表。

    先将目标图层名展开为候选集合，再构建图层索引到标准化名称集的映射，
    最后遍历所有对象，通过集合交集判断对象是否属于目标图层。
    图层名匹配忽略大小写和首尾空格，并兼容嵌套路径写法。

    Args:
        file3dm: 已读取的 Rhino 3dm 文件对象。
        layer_name: 目标图层名称（支持完整路径或末级名称）。

    Returns:
        属于目标图层的 (File3dmObject, CommonObject) 元组列表。
    """
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
    """
    判断两点是否在容差范围内重合。

    对 X、Y、Z 三个分量分别用绝对容差比较，全部满足才视为重合。
    用于去除曲线采样时首尾重复的闭合点。

    Args:
        a, b: 待比较的两个三维点。
        tol: 绝对容差，默认 1e-6。

    Returns:
        True 表示两点在容差范围内重合，False 表示不重合。
    """
    return (
        math.isclose(a.X, b.X, abs_tol=tol)
        and math.isclose(a.Y, b.Y, abs_tol=tol)
        and math.isclose(a.Z, b.Z, abs_tol=tol)
    )


def _curve_to_points(curve: rhino3dm.Curve, sample_count: int = 120) -> List[rhino3dm.Point3d]:
    """
    将曲线转换为点列表，优先取多段线顶点，否则均匀采样。

    优先尝试 TryGetPolyline 直接获取多段线顶点（精确且高效）；
    若不支持则沿参数域均匀采样 sample_count 个点。
    自动去除首尾重复点（闭合曲线）。

    Args:
        curve: Rhino 曲线对象。
        sample_count: 均匀采样点数，默认 120，最小保证 8 个点。

    Returns:
        Point3d 点列表，首尾不重复。
    """
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
    """
    将三维点列表投影到 XY 平面，返回二维坐标列表。

    Args:
        points: 三维点的可迭代对象。

    Returns:
        对应的二维坐标列表 [(x, y), ...]，Z 值被丢弃。
    """
    return [(float(pt.X), float(pt.Y)) for pt in points]


def _convex_hull(points: List[Point2D]) -> List[Point2D]:
    """
    Andrew's Monotone Chain 算法计算二维凸包。

    先对点集去重并按 x、y 排序，然后分别构建下凸包和上凸包，
    合并后得到逆时针方向的凸包顶点列表（首尾不重复）。
    用于从 Brep/Mesh 底面顶点中提取最小外接多边形。

    Args:
        points: 二维点列表（允许重复）。

    Returns:
        凸包顶点列表，按逆时针顺序排列，点数不足 3 时原样返回。
    """
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
    """
    从几何体中提取底面轮廓点（XY 平面）。

    按以下优先级依次尝试：
    1. Curve：直接采样曲线点；
    2. Extrusion：转换为 Brep 后处理；
    3. Brep：提取所有顶点，取最低 Z 层的底面点，计算凸包；
    4. Mesh：提取网格顶点，取最低 Z 层的底面点，计算凸包；
    5. 以上均失败时退化为 BoundingBox 底面四角点。

    Args:
        geometry: Rhino 几何体对象。

    Returns:
        底面轮廓的 Point3d 列表，Z 值为底面高度。
    """
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
    """
    用 Shoelace 公式计算二维多边形有符号面积。

    顺时针顶点返回负值，逆时针返回正值。
    调用方可用 abs() 取绝对值得到实际面积。

    Args:
        points: 多边形顶点列表（首尾不重复）。

    Returns:
        有符号面积，点数不足 3 时返回 0.0。
    """
    if len(points) < 3:
        return 0.0
    area = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return area * 0.5


def _polygon_centroid(points: List[Point2D]) -> Optional[Point2D]:
    """
    计算多边形重心（XY 平面）。

    使用基于 Shoelace 公式的面积加权重心算法，精度优于简单坐标平均。
    面积接近零（退化多边形）时返回 None。

    Args:
        points: 多边形顶点列表（首尾不重复）。

    Returns:
        重心坐标 (cx, cy)，点数不足 3 或面积为零时返回 None。
    """
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
    """
    判断点是否在线段 ab 上。

    先用叉积检验共线性，再用点积确认点落在线段范围内（而非延长线上）。

    Args:
        point: 待判断的点。
        a, b: 线段的两个端点。
        tol: 浮点容差，默认 1e-6。

    Returns:
        True 表示点在线段上（含端点），False 表示不在。
    """
    (px, py) = point
    (x1, y1) = a
    (x2, y2) = b
    cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1)
    if abs(cross) > tol:
        return False
    dot = (px - x1) * (px - x2) + (py - y1) * (py - y2)
    return dot <= tol


def _point_in_polygon(point: Point2D, polygon: List[Point2D]) -> bool:
    """
    射线法判断点是否在多边形内（边上的点视为在内部）。

    向右发射水平射线，统计与多边形边的交叉次数：奇数次则在内部。
    先用 _point_on_segment 检测边界情况，避免边上的点被误判为外部。

    Args:
        point: 待判断的二维点。
        polygon: 多边形顶点列表（按顺序排列，首尾不重复）。

    Returns:
        True 表示点在多边形内部或边上，False 表示在外部。
    """
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
    """
    判断两条线段是否相交（含端点共线情况）。

    使用方向叉积（orient）判断两端点相对于另一线段的方向：
    若两端点分别在另一线段两侧（方向相反），则线段相交。
    共线时额外用 on_segment 检验端点是否落在对方线段范围内。

    Args:
        a1, a2: 第一条线段的两个端点。
        b1, b2: 第二条线段的两个端点。

    Returns:
        True 表示两线段相交（含端点接触），False 表示不相交。
    """
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
    """
    判断两个多边形是否相交（含包含关系）。

    依次检查三种情况：
    1. poly_a 的任意顶点在 poly_b 内部（poly_a 被 poly_b 包含或部分重叠）；
    2. poly_b 的任意顶点在 poly_a 内部（poly_b 被 poly_a 包含或部分重叠）；
    3. 两多边形的边存在交叉（边界相交但顶点均不在对方内部）。

    Args:
        poly_a: 第一个多边形的顶点列表。
        poly_b: 第二个多边形的顶点列表。

    Returns:
        True 表示两多边形相交或存在包含关系，False 表示完全分离。
    """
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
    """
    判断 inner 多边形是否完全在 outer 多边形内部。

    先检查 inner 的所有顶点是否都在 outer 内，再检查两多边形的边是否存在
    非端点接触的真实交叉。两个条件同时满足才认为 inner 完全在 outer 内部。
    用于判断建筑是否完全落在绿地孔洞（允许建设区域）内，从而排除误报。

    Args:
        inner: 内多边形顶点列表（待判断是否被包含）。
        outer: 外多边形顶点列表（容器多边形）。

    Returns:
        True 表示 inner 完全在 outer 内部，False 表示存在超出部分。
    """
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
    """
    从对象 UserText 或 Attributes 中读取建筑名称，找不到时返回 fallback。

    优先读取 UserText 中的 "建筑名称" 或 "名称" 字段；
    若均不存在，则尝试从 Attributes 的多个属性名中获取对象名称。

    Args:
        obj: Rhino 文件对象。
        fallback: 找不到名称时的默认返回值（如 "建筑1"）。

    Returns:
        解析到的名称字符串，或 fallback。
    """
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


def _resolve_green_name(obj: rhino3dm.File3dmObject, fallback: str) -> str:
    """
    从对象 UserText 或 Attributes 中读取绿地/地块名称，找不到时返回 fallback。

    优先读取 UserText 中的 "地块名称" 或 "名称" 字段；
    若均不存在，则尝试从 Attributes 的多个属性名中获取对象名称。

    Args:
        obj: Rhino 文件对象。
        fallback: 找不到名称时的默认返回值（如 "绿地1"）。

    Returns:
        解析到的名称字符串，或 fallback。
    """
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


def _group_green_areas(entries: List[Dict]) -> List[Dict[str, List[Dict]]]:
    """
    将绿地退线区域按包含关系分组为外轮廓和内孔。

    按面积从大到小排序后逐一处理：若某区域的重心落在已有外轮廓内，
    则将其归为该外轮廓的孔洞（holes）；否则作为新的外轮廓（outer）。
    多个候选外轮廓时，选面积最小的那个（最近邻原则）。

    Args:
        entries: 绿地区域列表，每项包含 points2d、centroid、area、name 等字段。

    Returns:
        分组后的区域列表，每项格式为 {"outer": ..., "holes": [...]}。
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


def check_green_setback_violation(
    *,
    model_path: Path,
    green_setback_layer: str = "场地_绿地退线",
    building_layer: str = "模型_建筑体块",
    ignore_height: float = 2.0,
) -> Dict:
    """
    绿地退线违规检测主函数。

    从 .3dm 模型中读取绿地退线曲线和建筑体块，逐栋判断建筑底面是否
    与绿地退线区域相交。支持带洞多边形（外轮廓 + 内孔），高度不超过
    ignore_height 的建筑（如地下室、台阶等低矮构筑物）自动跳过检测。

    Args:
        model_path: .3dm 模型文件路径。
        green_setback_layer: 绿地退线曲线所在图层名称，默认 "场地_绿地退线"。
        building_layer: 建筑体块所在图层名称，默认 "模型_建筑体块"。
        ignore_height: 高度阈值（米），低于或等于此值的建筑不参与检测，默认 2.0。

    Returns:
        包含以下字段的字典：
        - status: "ok"
        - summary: 总建筑数、已检测数、忽略数、违规数、合规数
        - results: 逐栋检测结果列表（building_name, height, is_violation, green_name 等）
        - area_results: 各绿地区域的汇总统计（pass/fail、违规栋数）
        - green_areas: 绿地退线轮廓数据（供前端 3D 渲染，含外轮廓和孔洞）
        - warnings: 过程中产生的警告信息列表
        - parameters: 本次检测使用的参数

    Raises:
        ValueError: 模型文件无法读取，或指定图层中未找到有效对象。
    """
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Failed to read 3dm file: {model_path}")

    green_objects = _load_objects_from_layer(file3dm, green_setback_layer)
    if not green_objects:
        raise ValueError(f"No green setback curves found in layer: {green_setback_layer}")

    building_objects = _load_objects_from_layer(file3dm, building_layer)
    if not building_objects:
        raise ValueError(f"No buildings found in layer: {building_layer}")

    green_entries: List[Dict] = []
    invalid_curves = 0

    for idx, (obj, geometry) in enumerate(green_objects):
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
        name = _resolve_green_name(obj, f"绿地{idx + 1}")
        green_entries.append(
            {
                "points2d": poly2d,
                "min_z": min_z,
                "centroid": centroid,
                "area": area,
                "name": name,
            }
        )

    if not green_entries:
        raise ValueError(f"No valid green setback curves found in layer: {green_setback_layer}")

    green_areas = _group_green_areas(green_entries)
    green_area_shapes = []
    for index, area in enumerate(green_areas, start=1):
        outer = area["outer"]
        area_name = outer.get("name") or f"绿地{index}"
        area["name"] = area_name
        outer_z = outer["min_z"]
        outer_points = [[x, y, outer_z] for x, y in outer["points2d"]]
        holes = []
        for hole in area["holes"]:
            hole_z = hole["min_z"]
            holes.append([[x, y, hole_z] for x, y in hole["points2d"]])
        green_area_shapes.append(
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

        if height <= ignore_height:
            ignored_buildings += 1
            results.append(
                {
                    "building_name": building_name,
                    "object_id": str(object_id) if object_id else None,
                    "height": height,
                    "is_violation": False,
                    "reasons": ["below_ignore_height"],
                    "green_name": None,
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
        for area in green_areas:
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
        green_name = matched_area["name"] if matched_area else None

        if is_violation:
            violations += 1
            if green_name:
                area_stats.setdefault(green_name, {"checked": 0, "violations": 0})
                area_stats[green_name]["checked"] += 1
                area_stats[green_name]["violations"] += 1

        results.append(
            {
                "building_name": building_name,
                "object_id": str(object_id) if object_id else None,
                "height": height,
                "is_violation": is_violation,
                "reasons": ["inside_green_setback"] if is_violation else [],
                "green_name": green_name,
            }
        )

    warnings: List[str] = []
    if invalid_curves > 0:
        warnings.append(f"{invalid_curves} green setback curves are not valid")

    area_results = []
    for index, area in enumerate(green_areas, start=1):
        name = area.get("name") or f"绿地{index}"
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
        "green_areas": green_area_shapes,
        "warnings": warnings,
        "parameters": {
            "green_setback_layer": green_setback_layer,
            "building_layer": building_layer,
            "ignore_height": ignore_height,
        },
    }
