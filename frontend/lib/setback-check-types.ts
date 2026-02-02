export interface SetbackCheckPlotResult {
  plot_name: string;
  setback_length: number;
  overlap_length: number;
  frontage_rate: number;
  required_rate?: number | null;
  is_compliant?: boolean | null;
  building_count: number;
  highlight_segments?: [number, number, number][][];
  outline_points?: [number, number, number][];
  label_position?: [number, number, number];
}

export interface SetbackCheckSummary {
  total_plots: number;
  total_buildings: number;
  total_setback_length: number;
  total_overlap_length: number;
  overall_rate: number;
  unmatched_buildings: number;
}

export interface SetbackCheckResult {
  status: string;
  method: string;
  summary: SetbackCheckSummary;
  plots: SetbackCheckPlotResult[];
  warnings?: string[];
  parameters?: {
    building_layer?: string;
    setback_layer?: string;
    sample_step?: number;
    tolerance?: number;
    required_rate?: number | null;
  };
}
