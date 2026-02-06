/**
 * 视线通廊检测相关类型定义
 */

// 检测点位置
export interface SightCorridorPosition {
  x: number;
  y: number;
  z: number;
}

// 平面图点位（投影到地面）
export interface PlanViewPoint {
  x: number;
  y: number;
}

// 平面图建筑轮廓数据
export interface PlanViewBuilding {
  min: [number, number, number];
  max: [number, number, number];
  name?: string;
  footprint?: PlanViewPoint[];
  layerIndex?: number;
  layerName?: string;
}

// 平面图相机状态（来自3D视口的平面相机）
export interface PlanCameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
  upAxis: "y" | "z";
}

// 建筑可见性信息
export interface BuildingVisibility {
  building_name: string;
  distance: number;
  is_visible: boolean;
  reason?: string; // "超出范围" | "被遮挡"
  layer_index?: number;
  layer_name?: string;
}

// 视线通廊检测结果
export interface SightCorridorResult {
  status: string;
  max_visible_distance: number;
  visible_buildings: BuildingVisibility[];
  invisible_buildings: BuildingVisibility[];
  blocking_buildings?: Array<{
    building_name: string;
    layer_index?: number;
    layer_name?: string;
  }>;
  hemisphere_radius: number;
  observer_position: SightCorridorPosition;
}

// 视线通廊检测请求
export interface SightCorridorRequest {
  model_path: string;
  building_layer: string;
  observer_position: SightCorridorPosition;
  hemisphere_radius: number;
}

// 视线通廊限制（碰撞）检测结果
export interface CorridorCollisionBuilding {
  mesh_id?: string;
  building_name: string;
  layer_index?: number;
  layer_name?: string;
}

export interface CorridorCollisionResult {
  status: "clear" | "blocked" | "missing_corridor" | "missing_buildings";
  blocked_buildings: CorridorCollisionBuilding[];
}
