import type { SkyBridgeCheckResponse, SkyBridgePrepareResponse } from "./types";

const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export interface SkyBridgePrepareParams {
  model_path: string;
  plot_layer?: string;
  corridor_layer?: string;
  plot_name_key?: string;
  connection_key?: string;
}

export interface SkyBridgeCheckParams extends SkyBridgePrepareParams {
  elevation?: number;
  min_width?: number;
  min_height?: number;
  connections?: [string, string][];
}

export async function prepareSkyBridge(
  params: SkyBridgePrepareParams
): Promise<SkyBridgePrepareResponse> {
  const response = await fetch(`${apiBase}/sky-bridge-check/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "空中连廊信息读取失败");
  }

  return (await response.json()) as SkyBridgePrepareResponse;
}

export async function checkSkyBridge(params: SkyBridgeCheckParams): Promise<SkyBridgeCheckResponse> {
  const response = await fetch(`${apiBase}/sky-bridge-check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "空中连廊检测失败");
  }

  return (await response.json()) as SkyBridgeCheckResponse;
}

