export type PedestrianEntranceReason = "outside_redline";

export interface PedestrianEntranceResult {
  index: number;
  name: string;
  object_id?: string | null;
  point: [number, number, number];
  status: "pass" | "fail";
  reasons: PedestrianEntranceReason[];
}

export interface PedestrianEntranceCheckResponse {
  status: "ok";
  summary: {
    total: number;
    passed: number;
    failed: number;
    required_min: number;
    status: "pass" | "fail";
    reasons: string[];
  };
  redlines: {
    layer: string;
    point: [number, number, number];
  }[];
  results: PedestrianEntranceResult[];
  warnings: string[];
  parameters: {
    entrance_layer: string;
    redline_layer: string;
    redline_layers: string[];
    on_curve_tolerance: number;
    min_required_count: number;
  };
}
