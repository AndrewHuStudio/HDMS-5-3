export interface GreenSetbackBuildingResult {
  building_name: string;
  object_id?: string | null;
  height: number;
  is_violation: boolean;
  reasons: string[];
  green_name?: string | null;
}

export interface GreenSetbackSummary {
  total_buildings: number;
  checked_buildings: number;
  ignored_buildings: number;
  violations: number;
  compliant: number;
}

export interface GreenSetbackArea {
  name?: string;
  outer: [number, number, number][];
  holes: [number, number, number][][];
  base_z?: number;
}

export interface GreenSetbackAreaResult {
  name: string;
  status: "pass" | "fail";
  checked_buildings: number;
  violations: number;
}

export interface GreenSetbackCheckResponse {
  status: "ok";
  summary: GreenSetbackSummary;
  results: GreenSetbackBuildingResult[];
  area_results: GreenSetbackAreaResult[];
  green_areas: GreenSetbackArea[];
  warnings: string[];
  parameters: {
    green_setback_layer: string;
    building_layer: string;
    ignore_height: number;
  };
}
