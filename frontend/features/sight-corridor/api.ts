import type { SightCorridorResult, SightCorridorCheckParams, CorridorCollisionResult, CorridorCollisionParams } from "./types";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";

export async function checkSightCorridor(
  params: SightCorridorCheckParams
): Promise<SightCorridorResult> {
  const apiBase = normalizeApiBase(API_BASE);
  const endpoint = `${apiBase}/sight-corridor/check`;

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
    throw new Error(errorData.detail || "视线通廊检测失败");
  }

  return response.json();
}

export async function checkCorridorCollision(
  params: CorridorCollisionParams
): Promise<CorridorCollisionResult> {
  const apiBase = normalizeApiBase(API_BASE);
  const endpoint = `${apiBase}/sight-corridor/collision`;

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
    throw new Error("视线通廊碰撞检测失败");
  }

  return response.json();
}
