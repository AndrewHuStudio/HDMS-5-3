import type { FireLadderCheckResponse } from "./types";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";

export interface FireLadderCheckParams {
  model_path: string;
  building_layer?: string;
  fire_ladder_layer?: string;
  redline_layer?: string;
  plot_layer?: string;
  min_width?: number;
  min_distance?: number;
  max_distance?: number;
  length_ratio?: number;
}

export async function checkFireLadder(
  params: FireLadderCheckParams
): Promise<FireLadderCheckResponse> {
  const apiBase = normalizeApiBase(API_BASE);
  const primaryEndpoint = `${apiBase}/fire-ladder-check`;
  const fallbackEndpoint = `${apiBase}/fire-ladder/check`;

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
    throw new Error(errorData.detail || "消防登高面检测失败");
  }

  return (await response.json()) as FireLadderCheckResponse;
}
