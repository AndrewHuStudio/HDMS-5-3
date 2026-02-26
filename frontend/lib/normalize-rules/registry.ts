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
