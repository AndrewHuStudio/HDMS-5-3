/**
 * 规则注册表
 * 收集所有规则并按 order 排序，供管线引擎按序执行。
 */
import type { NormalizeRule } from "./types";

/**
 * Rule registry — collects all rules sorted by execution order.
 * Rules register themselves by pushing into this array.
 */
export const allRules: NormalizeRule[] = [];

/** Register one or more rules, keeping the array sorted by order. */
export function registerRules(...rules: NormalizeRule[]): void {
  allRules.push(...rules);
  allRules.sort((a, b) => a.order - b.order);
}
