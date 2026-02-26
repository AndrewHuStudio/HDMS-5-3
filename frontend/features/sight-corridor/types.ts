/**
 * 视线通廊检测相关类型定义
 */

export interface SightCorridorPosition {
  x: number;
  y: number;
  z: number;
}

export interface PlanViewPoint {
  x: number;
  y: number;
}

export interface PlanViewBuilding {
  min: [number, number, number];
  max: [number, number, number];
  name?: string;
  footprint?: PlanViewPoint[];
  layerIndex?: number;
  layerName?: string;
}

export interface PlanCameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
  upAxis: "y" | "z";
}

export interface BuildingVisibility {
  building_name: string;
  distance: number;
  is_visible: boolean;
  reason?: string;
  layer_index?: number;
  layer_name?: string;
}

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

export interface SightCorridorCheckParams {
  model_path: string;
  building_layer?: string;
  observer_position: SightCorridorPosition;
  hemisphere_radius: number;
}

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

export interface CorridorCollisionParams {
  model_path: string;
  corridor_layer?: string;
  building_layer?: string;
}
