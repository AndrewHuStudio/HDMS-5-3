"""
纯Python实现的建筑限高检测
不依赖Grasshopper和Rhino.Compute
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
def _normalize_plot_name(value: Optional[str]) -> str:
    return value.strip().casefold() if isinstance(value, str) else ""


def _get_object_name(obj: rhino3dm.File3dmObject) -> Optional[str]:
    attributes = getattr(obj, "Attributes", None)
    if not attributes:
        return None

    for attr_name in ("Name", "name", "ObjectName", "objectName"):
        value = getattr(attributes, attr_name, None)
        if callable(value):
            try:
                value = value()
            except Exception:
                value = None
        if isinstance(value, str) and value.strip():
            return value.strip()

    return None


def _build_layer_index_map(file3dm: rhino3dm.File3dm) -> Dict[int, str]:
    layer_by_index: Dict[int, str] = {}
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
            layer_by_index[layer_index] = layer_full_path

    return layer_by_index


def _point_in_curve_2d(point: rhino3dm.Point3d, curve: rhino3dm.Curve) -> bool:
    """
    判断点是否在平面曲线内（2D投影到XY平面）
    使用射线法（Ray Casting Algorithm）

    Args:
        point: 测试点
        curve: 平面曲线（必须是闭合曲线）

    Returns:
        True表示点在曲线内，False表示在曲线外
    """
    # 检查曲线是否闭合
    if not curve.IsClosed:
        logger.warning("Curve is not closed, cannot perform point-in-curve test")
        return False

    # 将曲线转换为多段线进行采样
    # 使用PointAt方法沿曲线采样点
    try:
        # 获取曲线的参数域
        domain = curve.Domain
        t_start = domain.T0
        t_end = domain.T1

        # 采样100个点
        sample_count = 100
        points = []
        for i in range(sample_count):
            t = t_start + (t_end - t_start) * i / sample_count
            pt = curve.PointAt(t)
            points.append((pt.X, pt.Y))

        # 射线法：从测试点向右发射射线，计算与多边形边的交点数
        # 如果交点数为奇数，则点在多边形内
        px, py = point.X, point.Y
        intersections = 0

        for i in range(len(points)):
            p1 = points[i]
            p2 = points[(i + 1) % len(points)]

            # 检查射线是否与边相交
            if (p1[1] > py) != (p2[1] > py):
                # 计算交点的x坐标
                x_intersect = (p2[0] - p1[0]) * (py - p1[1]) / (p2[1] - p1[1]) + p1[0]
                if px < x_intersect:
                    intersections += 1

        return intersections % 2 == 1

    except Exception as e:
        logger.error(f"Failed to perform point-in-curve test: {e}")
        return False


def _points_are_close(a: rhino3dm.Point3d, b: rhino3dm.Point3d, tol: float = 1e-6) -> bool:
    return (
        math.isclose(a.X, b.X, abs_tol=tol)
        and math.isclose(a.Y, b.Y, abs_tol=tol)
        and math.isclose(a.Z, b.Z, abs_tol=tol)
    )


def _curve_to_points(curve: rhino3dm.Curve, sample_count: int = 64) -> List[rhino3dm.Point3d]:
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

    count = max(sample_count, 4)
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


def _points_to_serializable(points: List[rhino3dm.Point3d]) -> List[List[float]]:
    return [[float(p.X), float(p.Y), float(p.Z)] for p in points]


def _polygon_area_2d(points: List[rhino3dm.Point3d]) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    for i in range(len(points)):
        p1 = points[i]
        p2 = points[(i + 1) % len(points)]
        area += p1.X * p2.Y - p2.X * p1.Y
    return abs(area) / 2.0


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


def _bbox_to_points(bbox: rhino3dm.BoundingBox) -> List[rhino3dm.Point3d]:
    z = bbox.Min.Z
    return [
        rhino3dm.Point3d(bbox.Min.X, bbox.Min.Y, z),
        rhino3dm.Point3d(bbox.Max.X, bbox.Min.Y, z),
        rhino3dm.Point3d(bbox.Max.X, bbox.Max.Y, z),
        rhino3dm.Point3d(bbox.Min.X, bbox.Max.Y, z),
    ]


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


def _plot_outline_from_geometry(
    geometry: rhino3dm.CommonObject, bbox: rhino3dm.BoundingBox
) -> Tuple[Optional[rhino3dm.Curve], List[rhino3dm.Point3d], float]:
    curves = _extract_boundary_curves(geometry)
    best_curve: Optional[rhino3dm.Curve] = None
    best_points: List[rhino3dm.Point3d] = []
    best_area = 0.0

    for curve in curves:
        if not isinstance(curve, rhino3dm.Curve):
            continue
        if not curve.IsClosed:
            continue
        points = _curve_to_points(curve, sample_count=128)
        if len(points) < 3:
            continue
        area = _polygon_area_2d(points)
        if area > best_area:
            best_area = area
            best_curve = curve
            best_points = points

    if best_points:
        return best_curve, best_points, best_area

    bbox_points = _bbox_to_points(bbox)
    return None, bbox_points, _polygon_area_2d(bbox_points)


def _match_plot_for_point(
    point: rhino3dm.Point3d, plots: List[Dict[str, object]]
) -> Optional[Dict[str, object]]:
    matches: List[Dict[str, object]] = []
    for plot in plots:
        points = plot.get("points") or []
        in_plot = False
        if isinstance(points, list) and points:
            in_plot = _point_in_polygon_2d(point, points)
        if not in_plot:
            curve = plot.get("curve")
            if isinstance(curve, rhino3dm.Curve):
                in_plot = _point_in_curve_2d(point, curve)
        if in_plot:
            matches.append(plot)

    if not matches:
        return None

    def _match_sort_key(item: Dict[str, object]) -> float:
        area = item.get("area")
        if isinstance(area, (int, float)) and area > 0:
            return float(area)
        return float("inf")

    matches.sort(key=_match_sort_key)
    return matches[0]


def _building_sample_points(bbox: rhino3dm.BoundingBox) -> List[rhino3dm.Point3d]:
    z = bbox.Min.Z
    return [
        bbox.Center,
        rhino3dm.Point3d(bbox.Min.X, bbox.Min.Y, z),
        rhino3dm.Point3d(bbox.Min.X, bbox.Max.Y, z),
        rhino3dm.Point3d(bbox.Max.X, bbox.Min.Y, z),
        rhino3dm.Point3d(bbox.Max.X, bbox.Max.Y, z),
    ]


def _match_plot_for_building(
    bbox: rhino3dm.BoundingBox, plots: List[Dict[str, object]]
) -> Optional[Dict[str, object]]:
    sample_points = _building_sample_points(bbox)
    best_plot: Optional[Dict[str, object]] = None
    best_score = 0
    best_area: Optional[float] = None

    for plot in plots:
        points = plot.get("points") or []
        curve = plot.get("curve")
        score = 0

        for pt in sample_points:
            in_plot = False
            if isinstance(points, list) and points:
                in_plot = _point_in_polygon_2d(pt, points)
            if not in_plot and isinstance(curve, rhino3dm.Curve):
                in_plot = _point_in_curve_2d(pt, curve)
            if in_plot:
                score += 1

        if score <= 0:
            continue

        area_value = plot.get("area")
        area = float(area_value) if isinstance(area_value, (int, float)) else None

        if score > best_score:
            best_plot = plot
            best_score = score
            best_area = area
            continue

        if score == best_score and area is not None:
            if best_area is None or area < best_area:
                best_plot = plot
                best_area = area

    return best_plot

def _load_objects_from_layer(
    file3dm: rhino3dm.File3dm, layer_name: str
) -> List[Tuple[rhino3dm.File3dmObject, rhino3dm.CommonObject]]:
    """
    从指定图层加载所有对象

    Args:
        file3dm: Rhino模型文件
        layer_name: 图层名称

    Returns:
        (对象, 几何体)元组的列表
    """
    # 标准化图层名称
    target_layer = layer_name.strip().lower()

    # 构建图层索引映射
    layer_by_index: Dict[int, str] = {}
    for i, layer in enumerate(file3dm.Layers):
        # 尝试获取图层索引
        layer_index = getattr(layer, "Index", None) or getattr(layer, "index", None) or i

        # 尝试获取图层名称
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
            # 标准化图层名称进行匹配
            normalized = layer_full_path.strip().lower()
            layer_by_index[layer_index] = normalized

    # 提取目标图层的对象
    objects = []
    for obj in file3dm.Objects:
        geometry = obj.Geometry
        if geometry is None:
            continue

        # 获取对象的图层索引
        attributes = getattr(obj, "Attributes", None)
        layer_index = getattr(attributes, "LayerIndex", None) if attributes else None

        if layer_index is None:
            continue

        # 检查是否属于目标图层
        obj_layer = layer_by_index.get(layer_index, "")
        if obj_layer == target_layer:
            objects.append((obj, geometry))

    return objects


def check_height_limit_pure_python(
    model_path: Path,
    building_layer: str = "模型_建筑体块",
    setback_layer: str = "限制_建筑退线",
    plot_layer: str = "场景_地块",
    default_height_limit: float = 100.0,
) -> Dict:
    """
    纯Python实现的建筑限高检测

    Args:
        model_path: 3dm模型文件路径
        building_layer: 建筑体块图层名称
        setback_layer: 建筑退线图层名称
        plot_layer: 地块图层名称（限高信息来源）
        default_height_limit: 默认限高值（米），当对象没有UserText时使用

    Returns:
        检测结果字典
    """
    # 读取模型
    file3dm = rhino3dm.File3dm.Read(str(model_path))
    if file3dm is None:
        raise ValueError(f"Failed to read 3dm file: {model_path}")

    layer_index_map = _build_layer_index_map(file3dm)

    # 加载建筑体块
    building_objects = _load_objects_from_layer(file3dm, building_layer)
    if not building_objects:
        raise ValueError(f"No buildings found in layer: {building_layer}")

    # 加载建筑退线（用于超限体块的边界）
    setback_objects = _load_objects_from_layer(file3dm, setback_layer)
    if not setback_objects:
        logger.warning("No setbacks found in layer: %s; will fallback to plot boundaries for volumes.", setback_layer)

    # 加载地块（限高信息来源）
    plot_objects = _load_objects_from_layer(file3dm, plot_layer)
    if not plot_objects:
        raise ValueError(f"No plots found in layer: {plot_layer}")

    logger.info(
        "Loaded %s buildings, %s setbacks, %s plots",
        len(building_objects),
        len(setback_objects),
        len(plot_objects),
    )
    logger.info(f"[DEBUG] 退线图层名称: '{setback_layer}'")
    logger.info(f"[DEBUG] 退线对象数量: {len(setback_objects)}")
    logger.info(f"[DEBUG] 地块图层名称: '{plot_layer}'")
    logger.info(f"[DEBUG] 地块对象数量: {len(plot_objects)}")

    # 解析地块限高信息
    plot_candidates = []
    missing_height_plots = set()
    invalid_plot_count = 0

    for idx, (obj, geometry) in enumerate(plot_objects):
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            invalid_plot_count += 1
            continue

        plot_name = _get_user_text(obj, "地块名称") or f"地块{idx + 1}"
        height_limit_str = _get_user_text(obj, "限高值") or _get_user_text(obj, "限高")
        height_limit = None
        if height_limit_str:
            try:
                height_limit = float(height_limit_str)
            except ValueError:
                height_limit = None

        if height_limit is None:
            missing_height_plots.add(plot_name)

        curve, outline_points, outline_area = _plot_outline_from_geometry(geometry, bbox)

        plot_candidates.append({
            "name": plot_name,
            "height_limit": height_limit,
            "center": bbox.Center,
            "curve": curve,
            "points": outline_points,
            "area": outline_area,
        })

    if not plot_candidates:
        raise ValueError(f"No valid plot objects found in layer: {plot_layer}")

    plot_info = []
    plot_by_name: Dict[str, Dict[str, object]] = {}
    for plot in plot_candidates:
        plot_entry = {
            "name": plot["name"],
            "height_limit": plot["height_limit"],
            "center": plot["center"],
            "curve": plot.get("curve"),
            "points": plot.get("points") or [],
            "area": plot.get("area") or 0.0,
            "has_usertext": plot["height_limit"] is not None,
        }
        plot_info.append(plot_entry)
        normalized_name = _normalize_plot_name(plot_entry["name"])
        if normalized_name:
            plot_by_name[normalized_name] = plot_entry

    logger.info(
        "[DEBUG] 有效地块数量: %s, 缺少限高: %s",
        len(plot_info),
        len(missing_height_plots),
    )

    if not plot_info:
        error_details = []
        error_details.append(f"在图层 '{plot_layer}' 中找到 {len(plot_objects)} 个对象")
        if missing_height_plots:
            error_details.append(f"其中 {len(missing_height_plots)} 个对象缺少限高信息")
        error_details.append("\n请在Rhino中为地块对象设置UserText:")
        error_details.append("1. 选中场景_地块对象（不是图层）")
        error_details.append("2. 按F3打开属性面板")
        error_details.append("3. 在'属性用户文本'区域添加:")
        error_details.append("   键: 限高值 (或 限高), 值: 100 (数值)")
        error_details.append("   键: 地块名称, 值: 地块1 (可选)")
        error_details.append("4. 保存模型 (Ctrl+S)")
        error_details.append("5. 重新上传模型到系统")
        raise ValueError("\n".join(error_details))

    # 解析退线（用于体块外形）
    setback_info = []
    invalid_setbacks = 0
    unmatched_setbacks = []

    if setback_objects:
        for idx, (obj, geometry) in enumerate(setback_objects):
            if not isinstance(geometry, rhino3dm.Curve):
                invalid_setbacks += 1
                continue
            plot_name = _get_user_text(obj, "地块名称")
            matched_plot = None
            if plot_name:
                matched_plot = plot_by_name.get(_normalize_plot_name(plot_name))
            if matched_plot is None:
                for candidate in plot_info:
                    if _point_in_curve_2d(candidate["center"], geometry):
                        matched_plot = candidate
                        break
            if matched_plot is None:
                unmatched_setbacks.append(plot_name or f"退线{idx + 1}")
                continue
            curve_points = _curve_to_points(geometry)
            setback_info.append({
                "name": matched_plot["name"],
                "height_limit": matched_plot["height_limit"],
                "curve": geometry,
                "points": curve_points,
                "has_usertext": matched_plot["height_limit"] is not None,
            })

    if not setback_info:
        logger.warning("No valid setback curves matched to plots; setback volumes will be empty.")

    # 检测每栋建筑
    results = []
    unmatched_buildings = []
    plot_name_mismatch: List[str] = []
    missing_building_names: List[str] = []

    for building_idx, (obj, geometry) in enumerate(building_objects):
        attributes = getattr(obj, "Attributes", None)
        layer_index = getattr(attributes, "LayerIndex", None) if attributes else None
        layer_name = layer_index_map.get(layer_index)
        object_id = getattr(attributes, "Id", None) if attributes else None
        object_name = _get_object_name(obj)
        building_plot_name = _get_user_text(obj, "地块名称")
        building_name = _get_user_text(obj, "建筑名称")
        if not building_name:
            missing_building_names.append(object_name or f"建筑{building_idx + 1}")
            building_name = object_name or layer_name or f"建筑{building_idx + 1}"
        # 获取建筑的BoundingBox
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            logger.warning(f"Building {building_idx} has no valid bounding box, skipping")
            continue

        # 获取建筑中心点和最高点
        max_height = bbox.Max.Z

        matched_plot = None
        if building_plot_name:
            matched_plot = plot_by_name.get(_normalize_plot_name(building_plot_name))
            if matched_plot is None:
                plot_name_mismatch.append(building_name)
                continue
            if _match_plot_for_building(bbox, [matched_plot]) is None:
                plot_name_mismatch.append(building_name)
                continue
        else:
            matched_plot = _match_plot_for_building(bbox, plot_info)

        if matched_plot is None:
            # 建筑不在任何地块内
            unmatched_buildings.append({
                "index": building_idx,
                "height": max_height,
            })
            continue

        if matched_plot["height_limit"] is None:
            missing_height_plots.add(matched_plot["name"])
            continue

        # 判断是否超限
        is_exceeded = max_height > matched_plot["height_limit"]
        exceed_amount = max_height - matched_plot["height_limit"] if is_exceeded else 0

        results.append({
            "building_index": building_idx,
            "building_name": building_name,
            "layer_index": layer_index,
            "layer_name": layer_name,
            "object_id": str(object_id) if object_id else None,
            "plot_name": matched_plot["name"],
            "height_limit": matched_plot["height_limit"],
            "actual_height": max_height,
            "is_exceeded": is_exceeded,
            "exceed_amount": exceed_amount,
        })

    # 统计结果
    total_buildings = len(results)
    exceeded_count = sum(1 for r in results if r["is_exceeded"])
    compliant_count = total_buildings - exceeded_count

    # 按地块分组统计
    plot_stats = {}
    for result in results:
        plot_name = result["plot_name"]
        if plot_name not in plot_stats:
            plot_stats[plot_name] = {
                "plot_name": plot_name,
                "height_limit": result["height_limit"],
                "total": 0,
                "exceeded": 0,
                "compliant": 0,
            }
        plot_stats[plot_name]["total"] += 1
        if result["is_exceeded"]:
            plot_stats[plot_name]["exceeded"] += 1
        else:
            plot_stats[plot_name]["compliant"] += 1

    plot_exceeded: Dict[str, bool] = {plot["name"]: False for plot in plot_info}
    for result in results:
        if result["is_exceeded"]:
            plot_exceeded[result["plot_name"]] = True

    setback_volumes = []
    logger.info(f"[DEBUG] 开始构建setback_volumes，setback_info数量: {len(setback_info)}")
    for plot in setback_info:
        if plot["height_limit"] is None:
            continue
        points = plot.get("points") or []
        volume = {
            "plot_name": plot["name"],
            "height_limit": plot["height_limit"],
            "is_exceeded": plot_exceeded.get(plot["name"], False),
            "points": _points_to_serializable(points),
        }
        setback_volumes.append(volume)
        logger.info(f"[DEBUG] 添加setback_volume: {plot['name']}, 超限: {volume['is_exceeded']}, 点数: {len(points)}")

    logger.info(f"[DEBUG] setback_volumes构建完成，总数: {len(setback_volumes)}")

    # 构建返回结果
    warnings = []
    if unmatched_buildings:
        warnings.append(f"{len(unmatched_buildings)} buildings are not within any plot boundary")
    if missing_height_plots:
        missing_list = ", ".join(sorted(missing_height_plots))
        warnings.append(f"以下地块缺少限高信息: {missing_list}")
    if unmatched_setbacks:
        missing_setbacks = ", ".join(unmatched_setbacks)
        warnings.append(f"{len(unmatched_setbacks)} setback objects are not matched to any plot: {missing_setbacks}")
    if invalid_setbacks > 0:
        warnings.append(f"{invalid_setbacks} setback objects are not valid curves")
    if plot_name_mismatch:
        warnings.append(f"{len(plot_name_mismatch)} buildings have mismatched plot name: {', '.join(plot_name_mismatch[:5])}")
    if missing_building_names:
        warnings.append(f"{len(missing_building_names)} buildings missing 建筑名称 usertext")
    if invalid_plot_count > 0:
        warnings.append(f"{invalid_plot_count} plot objects have invalid geometry")

    result_dict = {
        "status": "ok",
        "method": "pure_python",
        "summary": {
            "total_buildings": total_buildings,
            "exceeded_count": exceeded_count,
            "compliant_count": compliant_count,
            "unmatched_buildings": len(unmatched_buildings),
        },
        "buildings": results,
        "plot_statistics": list(plot_stats.values()),
        "setback_volumes": setback_volumes,
        "unmatched_buildings": unmatched_buildings,
        "warnings": warnings,
    }

    logger.info(f"[DEBUG] 返回结果的keys: {list(result_dict.keys())}")
    logger.info(f"[DEBUG] setback_volumes在结果中: {'setback_volumes' in result_dict}")
    logger.info(f"[DEBUG] setback_volumes长度: {len(result_dict['setback_volumes'])}")

    return result_dict
