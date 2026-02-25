export type VehicleEntranceReason =
  | "too_close_main_intersection"
  | "too_close_secondary_intersection"
  | "too_close_branch_intersection";

export interface VehicleEntranceResult {
  index: number;
  name: string;
  object_id?: string | null;
  point: [number, number, number];
  status: "pass" | "fail";
  reasons: VehicleEntranceReason[];
  distances: {
    main: number | null;
    secondary: number | null;
    branch: number | null;
  };
}

export interface VehicleEntranceCheckResponse {
  status: "ok";
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  results: VehicleEntranceResult[];
  warnings: string[];
  parameters: {
    entrance_layer: string;
    main_intersection_layer: string;
    secondary_intersection_layer: string;
    branch_intersection_layer: string;
    min_main_distance: number;
    min_secondary_distance: number;
    min_branch_distance: number;
  };
}
