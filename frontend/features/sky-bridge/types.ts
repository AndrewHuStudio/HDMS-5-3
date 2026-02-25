export interface PlotInfo {
  name: string;
  center: [number, number, number];
  polygon: [number, number, number][];
  top_z: number;
}

export interface SkyBridgeConnection {
  from: string;
  to: string;
}

export interface SkyBridgePrepareResponse {
  status: "ok";
  plots: PlotInfo[];
  connections: SkyBridgeConnection[];
  warnings: string[];
  parameters: {
    plot_layer: string;
    corridor_layer: string;
    plot_name_key: string;
    connection_key: string;
  };
}

export type SkyBridgeReason =
  | "plot_missing"
  | "missing_corridor"
  | "not_connecting"
  | "not_closed"
  | "clearance_too_low"
  | "width_too_small"
  | "height_too_small";

export interface SkyBridgeCorridorResult {
  index: number;
  status: "pass" | "fail";
  reasons: SkyBridgeReason[];
  width: number;
  height: number;
  clearance: number;
  is_closed: boolean;
  intersects_a: boolean;
  intersects_b: boolean;
  object_id?: string | null;
  bbox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  outline_points: [number, number, number][];
}

export interface SkyBridgeResult {
  connection_id: number;
  plot_a: string;
  plot_b: string;
  status: "pass" | "fail";
  reasons: SkyBridgeReason[];
  label_position: [number, number, number];
  corridors: SkyBridgeCorridorResult[];
}

export interface SkyBridgeCheckResponse {
  status: "ok";
  summary: {
    total_connections: number;
    passed: number;
    failed: number;
    no_connections: number;
  };
  results: SkyBridgeResult[];
  warnings: string[];
  parameters: {
    plot_layer: string;
    corridor_layer: string;
    plot_name_key: string;
    connection_key: string;
    elevation: number;
    min_width: number;
    min_height: number;
  };
}

