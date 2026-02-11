import type { SkyBridgeResult, SkyBridgeReason } from "./types";

/**
 * 从空中连廊检测结果中提取失败原因
 */
export function deriveConnectionReasons(result: SkyBridgeResult): SkyBridgeReason[] {
  if (result.status === "pass") return [];

  // 如果已经有明确的 reasons，直接返回
  if (result.reasons && result.reasons.length > 0) {
    return result.reasons;
  }

  // 否则根据 corridors 的状态推断原因
  const reasons: SkyBridgeReason[] = [];

  if (result.corridors.length === 0) {
    reasons.push("missing_corridor");
    return reasons;
  }

  // 检查每个连廊的问题
  result.corridors.forEach((corridor) => {
    if (corridor.status === "fail") {
      if (!corridor.is_closed && !reasons.includes("not_closed")) {
        reasons.push("not_closed");
      }
      if (corridor.width < 4 && !reasons.includes("width_too_small")) {
        reasons.push("width_too_small");
      }
      if (corridor.height < 2.2 && !reasons.includes("height_too_small")) {
        reasons.push("height_too_small");
      }
      if (corridor.clearance < 5 && !reasons.includes("clearance_too_low")) {
        reasons.push("clearance_too_low");
      }
    }
  });

  return reasons.length > 0 ? reasons : ["not_connecting"];
}
