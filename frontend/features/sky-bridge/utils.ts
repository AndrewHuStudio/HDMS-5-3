/**
 * 空中连廊检测工具函数
 * deriveConnectionReasons: 从检测结果中提取连接失败原因列表，优先返回 missing_corridor。
 */
import type { SkyBridgeReason, SkyBridgeResult } from "./types";

const reasonOrder: SkyBridgeReason[] = [
  "plot_missing",
  "missing_corridor",
  "not_connecting",
  "not_closed",
  "clearance_too_low",
  "width_too_small",
  "height_too_small",
];

export function deriveConnectionReasons(result: SkyBridgeResult): SkyBridgeReason[] {
  if (result.reasons && result.reasons.length > 0) {
    if (result.reasons.includes("missing_corridor")) {
      return ["missing_corridor"];
    }
    return result.reasons;
  }

  if (!result.corridors || result.corridors.length === 0) {
    return [];
  }

  const reasonSet = new Set<SkyBridgeReason>();
  result.corridors.forEach((corridor) => {
    corridor.reasons.forEach((reason) => reasonSet.add(reason));
  });

  if (reasonSet.has("missing_corridor")) {
    return ["missing_corridor"];
  }

  return reasonOrder.filter((reason) => reasonSet.has(reason));
}
