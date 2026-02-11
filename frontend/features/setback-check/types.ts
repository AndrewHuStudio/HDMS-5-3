export type SetbackViolationReason = "missing_setback" | "invalid_setback";

export interface SetbackViolationBuildingResult {
  building_index: number;
  building_name: string;
  plot_name: string | null;
  is_exceeded: boolean;
  reason?: SetbackViolationReason | null;
  object_id?: string | null;
  layer_name?: string | null;
  layer_index?: number | null;
}

export interface SetbackViolationSummary {
  total_buildings: number;
  exceeded_count: number;
  compliant_count: number;
  unmatched_buildings: number;
}

export interface SetbackViolationResult {
  status: string;
  summary: SetbackViolationSummary;
  buildings: SetbackViolationBuildingResult[];
  warnings?: string[];
  parameters?: {
    building_layer?: string;
    setback_layer?: string;
    plot_layer?: string;
  };
}

export interface SetbackCheckParams {
  model_path: string;
  building_layer?: string;
  setback_layer?: string;
  plot_layer?: string;
}
