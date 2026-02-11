import type { SetbackViolationResult } from "./types";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";

export interface SetbackCheckRequestParams {
  model_path: string;
  building_layer?: string;
  setback_layer?: string;
  plot_layer?: string;
}

export async function checkSetback(
  params: SetbackCheckRequestParams
): Promise<SetbackViolationResult> {
  const apiBase = normalizeApiBase(API_BASE);
  const endpoint = `${apiBase}/setback-check`;

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
    throw new Error(errorData.detail || "退线检测失败");
  }

  return response.json();
}
