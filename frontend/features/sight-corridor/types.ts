/**
 * 视线通廊（碰撞检测）相关类型定义
 */

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
