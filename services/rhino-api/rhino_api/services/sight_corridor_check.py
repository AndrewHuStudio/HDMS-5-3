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

logger = logging.getLogger(__name__)


def _get_user_text_from_source(source: object, key: str) -> Optional[str]:
    """从对象中读取UserText"""
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

    if hasattr(source, "GetUserStrings"):
        try:
            entries = source.GetUserStrings()
        except Exception:
            return None

        if isinstance(entries, dict):
            for k, v in entries.items():
                candidate = str(k).strip()
                if candidate == normalized_key or candidate.casefold() == normalized_lower:
                    if isinstance(v, str) and v.strip():
                        return v

    return None


def _get_user_text(obj: rhino3dm.File3dmObject, key: str) -> Optional[str]:
    """从Rhino对象中读取UserText"""
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
    """获取几何体的BoundingBox"""
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


def _load_objects_from_layer(
    file3dm: rhino3dm.File3dm, layer_name: str
) -> List[Tuple[rhino3dm.File3dmObject, rhino3dm.CommonObject]]:
    """从指定图层加载所有对象"""
    target_layer = layer_name.strip().lower()

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
            normalized = layer_full_path.strip().lower()
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

        obj_layer = layer_by_index.get(layer_index, "")
        if obj_layer == target_layer:
            objects.append((obj, geometry))

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
    for idx, (obj, geometry) in enumerate(building_objects):
        bbox = _get_bounding_box(geometry)
        if bbox is None:
            logger.warning(f"Building {idx} has no valid bounding box, skipping")
            continue

        # 读取建筑名称
        building_name = _get_user_text(obj, "建筑名称") or f"建筑{idx + 1}"

        # 计算建筑中心点
        center = bbox.Center

        buildings.append({
            "index": idx,
            "name": building_name,
            "bbox": bbox,
            "center": (center.X, center.Y, center.Z),
            "geometry": geometry,
        })

    logger.info(f"Parsed {len(buildings)} valid buildings")

    # 观察者位置
    obs_x, obs_y, obs_z = observer_position

    # 计算每个建筑的可见性
    visible_buildings = []
    invisible_buildings = []

    for building in buildings:
        center_x, center_y, center_z = building["center"]

        # 计算距离（3D欧氏距离）
        distance = math.sqrt(
            (center_x - obs_x) ** 2 +
            (center_y - obs_y) ** 2 +
            (center_z - obs_z) ** 2
        )

        # 检查是否在半球范围内
        if distance > hemisphere_radius:
            invisible_buildings.append({
                "building_name": building["name"],
                "distance": distance,
                "is_visible": False,
                "reason": "超出范围",
            })
            continue

        # 射线方向：从观察者指向建筑中心
        ray_direction = (
            center_x - obs_x,
            center_y - obs_y,
            center_z - obs_z,
        )

        # 检查是否被其他建筑遮挡
        is_blocked = False
        for other_building in buildings:
            if other_building["index"] == building["index"]:
                continue

            # 射线与其他建筑的BoundingBox相交检测
            intersection_dist = _ray_box_intersection(
                observer_position,
                ray_direction,
                other_building["bbox"],
            )

            # 如果相交且交点距离小于目标建筑距离，说明被遮挡
            if intersection_dist is not None and intersection_dist < distance - 0.1:
                is_blocked = True
                break

        if is_blocked:
            invisible_buildings.append({
                "building_name": building["name"],
                "distance": distance,
                "is_visible": False,
                "reason": "被遮挡",
            })
        else:
            visible_buildings.append({
                "building_name": building["name"],
                "distance": distance,
                "is_visible": True,
            })

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
