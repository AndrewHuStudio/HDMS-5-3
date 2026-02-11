export interface HeightCheckSetbackVolume {
  plot_name: string;
  height_limit: number;
  is_exceeded: boolean;
  points: [number, number, number][];
}

export interface BuildingResult {
  building_index: number;
  plot_name: string;
  building_name?: string;
  layer_index?: number;
  layer_name?: string;
  object_id?: string | null;
  height_limit: number;
  actual_height: number;
  is_exceeded: boolean;
  exceed_amount: number;
}

export interface HeightCheckParams {
  model_path: string;
  building_layer?: string;
  setback_layer?: string;
  plot_layer?: string;
}

export interface HeightCheckResponse {
  status: "ok";
  method: "pure_python";
  buildings: BuildingResult[];
  warnings: string[];
  setback_volumes: HeightCheckSetbackVolume[];
}
