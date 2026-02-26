/** 绿地退线检测 API 封装 - 调用后端 /green-setback-check 端点 */
import type { GreenSetbackCheckResponse } from "./types";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";

export interface GreenSetbackCheckParams {
  model_path: string;
  green_setback_layer?: string;
  building_layer?: string;
  ignore_height?: number;
}

export async function checkGreenSetback(
  params: GreenSetbackCheckParams
): Promise<GreenSetbackCheckResponse> {
  const apiBase = normalizeApiBase(API_BASE);
  const primaryEndpoint = `${apiBase}/green-setback-check`;
  const fallbackEndpoint = `${apiBase}/green-setback/check`;

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
    throw new Error(errorData.detail || "绿地退线检测失败");
  }

  return response.json();
}
