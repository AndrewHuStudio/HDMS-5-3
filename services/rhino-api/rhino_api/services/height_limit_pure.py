"""
纯Python实现的建筑限高检测
不依赖Grasshopper和Rhino.Compute
"""
from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import List, Dict, Tuple, Optional, Iterable

import rhino3dm

logger = logging.getLogger(__name__)


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
    """
    从Rhino对象中读取UserText

    Args:
        obj: Rhino对象
        key: UserText的键名

    Returns:
        UserText的值，如果不存在则返回None
    """
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
    except Exception as e:
        logger.warning(f"Failed to read UserText '{key}': {e}")
        return None


def _get_bounding_box(geometry: rhino3dm.CommonObject) -> Optional[rhino3dm.BoundingBox]:
    """
    获取几何体的BoundingBox

    Args:
        geometry: Rhino几何体

    Returns:
        BoundingBox对象，如果失败则返回None
    """
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
    default_height_limit: float = 100.0,
) -> Dict:
    """
    纯Python实现的建筑限高检测

    Args:
        model_path: 3dm模型文件路径
        building_layer: 建筑体块图层名称
        setback_layer: 建筑退线图层名称
        default_height_limit: 默认限高值（米），当对象没有UserText时使用

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

    # 加载建筑退线
    setback_objects = _load_objects_from_layer(file3dm, setback_layer)
    if not setback_objects:
        raise ValueError(f"No setbacks found in layer: {setback_layer}")

    logger.info(f"Loaded {len(building_objects)} buildings and {len(setback_objects)} setbacks")
    logger.info(f"[DEBUG] 退线图层名称: '{setback_layer}'")
    logger.info(f"[DEBUG] 退线对象数量: {len(setback_objects)}")

    # 解析每个退线的限高信息
    setback_info = []
    missing_usertext_count = 0
    invalid_geometry_count = 0

    for idx, (obj, geometry) in enumerate(setback_objects):
        logger.info(f"[DEBUG] 处理退线对象 {idx}, 类型: {type(geometry).__name__}")
        # 检查几何体类型
        if not isinstance(geometry, rhino3dm.Curve):
            logger.warning(f"Setback object {idx} is not a curve (type: {type(geometry).__name__}), skipping")
            invalid_geometry_count += 1
            continue

        # 读取UserText中的限高和地块名称
        height_limit_str = _get_user_text(obj, "限高")
        plot_name = _get_user_text(obj, "地块名称") or f"地块{len(setback_info) + 1}"
        logger.info(f"[DEBUG] 退线对象 {idx}: 限高='{height_limit_str}', 地块名称='{plot_name}'")
        curve_points = _curve_to_points(geometry)

        # 必须设置UserText，不使用默认值
        if not height_limit_str:
            logger.warning(f"Setback object {idx} missing '限高' UserText, skipping")
            missing_usertext_count += 1
            continue

        try:
            height_limit = float(height_limit_str)
        except ValueError:
            logger.warning(f"Invalid height limit value: {height_limit_str}, skipping")
            continue

        setback_info.append({
            "name": plot_name,
            "height_limit": height_limit,
            "curve": geometry,
            "points": curve_points,
            "has_usertext": True,
        })
        logger.info(f"[DEBUG] 成功添加退线信息: {plot_name}, 限高: {height_limit}, 点数: {len(curve_points)}")

    logger.info(f"[DEBUG] 有效退线数量: {len(setback_info)}, 缺少UserText: {missing_usertext_count}, 无效几何: {invalid_geometry_count}")

    if not setback_info:
        error_details = []
        error_details.append(f"在图层 '{setback_layer}' 中找到 {len(setback_objects)} 个对象")
        if missing_usertext_count > 0:
            error_details.append(f"其中 {missing_usertext_count} 个对象缺少 '限高' UserText")
        if invalid_geometry_count > 0:
            error_details.append(f"其中 {invalid_geometry_count} 个对象不是曲线类型")
        error_details.append("\n请在Rhino中为退线对象设置UserText:")
        error_details.append("1. 选中退线对象（不是图层）")
        error_details.append("2. 按F3打开属性面板")
        error_details.append("3. 在'属性用户文本'区域添加:")
        error_details.append("   键: 限高, 值: 100 (数值)")
        error_details.append("   键: 地块名称, 值: 地块1 (可选)")
        error_details.append("4. 保存模型 (Ctrl+S)")
        error_details.append("5. 重新上传模型到系统")
        raise ValueError("\n".join(error_details))

    logger.info(f"Found {len(setback_info)} valid setbacks with height limits")

    # 检测每栋建筑
    results = []
    unmatched_buildings = []

    for building_idx, (obj, geometry) in enumerate(building_objects):
        # 获取建筑的BoundingBox
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            logger.warning(f"Building {building_idx} has no valid bounding box, skipping")
            continue

        # 获取建筑中心点和最高点
        center = bbox.Center
        max_height = bbox.Max.Z

        # 判断建筑属于哪个地块
        matched_plot = None
        for setback in setback_info:
            if _point_in_curve_2d(center, setback["curve"]):
                matched_plot = setback
                break

        if matched_plot is None:
            # 建筑不在任何地块内
            unmatched_buildings.append({
                "index": building_idx,
                "height": max_height,
            })
            continue

        # 判断是否超限
        is_exceeded = max_height > matched_plot["height_limit"]
        exceed_amount = max_height - matched_plot["height_limit"] if is_exceeded else 0

        results.append({
            "building_index": building_idx,
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

    plot_exceeded: Dict[str, bool] = {plot["name"]: False for plot in setback_info}
    for result in results:
        if result["is_exceeded"]:
            plot_exceeded[result["plot_name"]] = True

    setback_volumes = []
    logger.info(f"[DEBUG] 开始构建setback_volumes，setback_info数量: {len(setback_info)}")
    for plot in setback_info:
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
        warnings.append(f"{len(unmatched_buildings)} buildings are not within any setback boundary")

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
