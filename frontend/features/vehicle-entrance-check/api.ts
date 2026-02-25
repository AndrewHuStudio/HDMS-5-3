import type { VehicleEntranceCheckResponse } from "./types";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";

export interface VehicleEntranceCheckParams {
  model_path: string;
  entrance_layer?: string;
  main_intersection_layer?: string;
  secondary_intersection_layer?: string;
  branch_intersection_layer?: string;
  min_main_distance?: number;
  min_secondary_distance?: number;
  min_branch_distance?: number;
}

export async function checkVehicleEntrance(
  params: VehicleEntranceCheckParams
): Promise<VehicleEntranceCheckResponse> {
  const apiBase = normalizeApiBase(API_BASE);
  const primaryEndpoint = `${apiBase}/vehicle-entrance-check`;
  const fallbackEndpoint = `${apiBase}/vehicle-entrance/check`;

  const doRequest = async (endpoint: string) =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(params),
    });

  let response = await doRequest(primaryEndpoint);
  if (response.status === 404) {
    response = await doRequest(fallbackEndpoint);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`检测接口未找到: ${primaryEndpoint}`);
    }
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.detail || "车行出入口检测失败"
    );
  }

  return response.json();
}
