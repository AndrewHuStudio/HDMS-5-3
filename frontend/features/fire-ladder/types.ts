export type FireLadderReason =
  | "no_buildings"
  | "missing_ladder"
  | "outside_redline"
  | "width_too_small"
  | "length_sum_too_short"
  | "distance_out_of_range";

export interface FireLadderBuildingInfo {
  name: string;
  object_id?: string | null;
  perimeter: number;
}

export interface FireLadderDetail {
  index: number;
  width: number;
  length: number;
  distance: number;
  inside_redline: boolean;
  object_id?: string | null;
  building_object_id?: string | null;
  building_name?: string;
  outline_points: [number, number, number][];
}

export interface FireLadderResult {
  redline_index: number;
  redline_name: string;
  status: "pass" | "fail";
  reasons: FireLadderReason[];
  building: FireLadderBuildingInfo | null;
  label_position: [number, number, number];
  ladders: FireLadderDetail[];
  length_sum: number;
  length_required: number;
}

export interface FireLadderCheckResponse {
  status: "ok";
  method: "pure_python";
  summary: {
    total_redlines: number;
    passed: number;
    failed: number;
    no_buildings: number;
  };
  results: FireLadderResult[];
  warnings: string[];
  parameters: {
    building_layer: string;
    fire_ladder_layer: string;
    redline_layer: string;
    plot_layer: string;
    min_width: number;
    min_distance: number;
    max_distance: number;
    length_ratio: number;
  };
}
