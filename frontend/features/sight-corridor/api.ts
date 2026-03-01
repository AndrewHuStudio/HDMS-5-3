import type { CorridorCollisionResult, CorridorCollisionParams } from "./types";
import { resolveApiBase } from "@/lib/api-base";

export async function checkCorridorCollision(
  params: CorridorCollisionParams
): Promise<CorridorCollisionResult> {
  const apiBase = await resolveApiBase();
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
