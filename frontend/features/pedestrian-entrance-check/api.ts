/** 人行出入口检测 API 封装 - 调用后端 /pedestrian-entrance-check 端点 */
import type { PedestrianEntranceCheckResponse } from "./types";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";

export interface PedestrianEntranceCheckParams {
  model_path: string;
  entrance_layer?: string;
  redline_layer?: string;
  redline_layers?: string[];
  plot_layer?: string;
  on_curve_tolerance?: number;
  min_required_count?: number;
}

export async function checkPedestrianEntrance(
  params: PedestrianEntranceCheckParams
): Promise<PedestrianEntranceCheckResponse> {
  const apiBase = normalizeApiBase(API_BASE);
  const primaryEndpoint = `${apiBase}/pedestrian-entrance-check`;
  const fallbackEndpoint = `${apiBase}/pedestrian-entrance/check`;

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
    throw new Error(errorData.detail || "人行出入口检测失败");
  }

  return response.json();
}
