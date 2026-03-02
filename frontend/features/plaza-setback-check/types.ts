/** 广场退线检测 - 类型定义 */

export interface PlazaSetbackBuildingResult {
  building_name: string;
  object_id?: string | null;
  height: number;
  is_violation: boolean;
  reasons: string[];
  plaza_name?: string | null;
  plot_name?: string | null;
}

export interface PlazaSetbackSummary {
  total_buildings: number;
  checked_buildings: number;
  ignored_buildings: number;
  violations: number;
  compliant: number;
}

export interface PlazaSetbackArea {
  id?: string;
  name?: string;
  plot_name?: string | null;
  outer: [number, number, number][];
  holes: [number, number, number][][];
  base_z?: number;
}

export interface PlazaSetbackAreaResult {
  id: string;
  name: string;
  plot_name?: string | null;
  status: "pass" | "fail";
  checked_buildings: number;
  violations: number;
}

export interface PlazaSetbackCheckResponse {
  status: "ok";
  summary: PlazaSetbackSummary;
  results: PlazaSetbackBuildingResult[];
  area_results: PlazaSetbackAreaResult[];
  plaza_areas: PlazaSetbackArea[];
  warnings: string[];
  parameters: {
    plaza_setback_layer: string;
    building_layer: string;
    plot_layer: string;
    ignore_height: number;
  };
}
