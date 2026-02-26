export type SkyBridgeReason =
  | "plot_missing"
  | "missing_corridor"
  | "not_connecting"
  | "not_closed"
  | "clearance_too_low"
  | "width_too_small"
  | "height_too_small";

export interface CorridorDetail {
  index: number;
  width: number;
  height: number;
  clearance: number;
  is_closed: boolean;
  status: "pass" | "fail";
  object_id?: string | null;
  outline_points: [number, number, number][];
}

export interface SkyBridgeResult {
  connection_id: string;
  plot_a: string;
  plot_b: string;
  status: "pass" | "fail";
  reasons: SkyBridgeReason[];
  label_position: [number, number, number];
  corridors: CorridorDetail[];
}

export interface SkyBridgeCheckResponse {
  status: "ok";
  method: "pure_python";
  summary: {
    total_connections: number;
    passed: number;
    failed: number;
  };
  results: SkyBridgeResult[];
  warnings: string[];
  parameters: {
    corridor_layer: string;
    plot_layer: string;
    min_width: number;
    min_height: number;
    min_clearance: number;
  };
}
