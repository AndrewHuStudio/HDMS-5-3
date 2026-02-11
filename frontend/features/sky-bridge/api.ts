import type { SkyBridgeCheckResponse } from "./types";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";

export interface SkyBridgeCheckParams {
  model_path: string;
  corridor_layer?: string;
  plot_layer?: string;
  min_width?: number;
  min_height?: number;
  min_clearance?: number;
}

export async function checkSkyBridge(
  params: SkyBridgeCheckParams
): Promise<SkyBridgeCheckResponse> {
  const apiBase = normalizeApiBase(API_BASE);
  const primaryEndpoint = `${apiBase}/sky-bridge-check`;
  const fallbackEndpoint = `${apiBase}/sky-bridge/check`;

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
    const errorText = await response.text();
    throw new Error(`空中连廊检测失败: ${errorText}`);
  }

  return response.json();
}
