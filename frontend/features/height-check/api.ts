import type { HeightCheckResponse } from "./types";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";

export interface HeightCheckRequestParams {
  model_path: string;
  building_layer?: string;
  setback_layer?: string;
  plot_layer?: string;
}

export async function checkHeight(
  params: HeightCheckRequestParams
): Promise<HeightCheckResponse> {
  const apiBase = normalizeApiBase(API_BASE);
  const endpoint = `${apiBase}/height-check/pure-python`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`检测接口未找到: ${endpoint}`);
    }
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "限高检测失败");
  }

  return response.json();
}
