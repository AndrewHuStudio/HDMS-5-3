import type { FireLadderCheckResponse } from "./types";

const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

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
  const response = await fetch(`${apiBase}/fire-ladder-check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "消防登高面检测失败");
  }

  return (await response.json()) as FireLadderCheckResponse;
}
