/**
 * 规则：mixed-list-stabilization
 *
 * Final-pass structural cleanup for mixed bullet/ordered lead-in blocks that
 * appear after image/citation/table injection. This converts isolated ordered
 * items surrounded by sibling bullet lines into a single unordered list block,
 * which is more stable than allowing Markdown to emit split <ul>/<ol>/<ul>.
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { transformUnprotected } from "../utils";

const BULLET_RE = /^(\s{0,3})[-*+]\s+(.+)$/;
const ORDERED_RE = /^(\s{0,3})\d+[.)]\s+(.+)$/;
const HEADING_RE = /^\s*#{1,6}\s+\S/;
const TABLE_ROW_RE = /^\s*\|.+\|\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

function isBoundary(line: string): boolean {
  const trimmed = (line || "").trim();
  if (!trimmed) return true;
  return HEADING_RE.test(line) || TABLE_ROW_RE.test(line) || FENCE_RE.test(line);
}

function normalizeMixedListClusters(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const bulletMatch = line.match(BULLET_RE);
    const orderedMatch = line.match(ORDERED_RE);

    if (!bulletMatch && !orderedMatch) {
      out.push(line);
      i += 1;
      continue;
    }

    const start = i;
    const cluster: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? "";
      const trimmed = current.trim();
      if (!trimmed) {
        cluster.push(current);
        i += 1;
        continue;
      }
      if (isBoundary(current)) break;
      if (!BULLET_RE.test(current) && !ORDERED_RE.test(current) && !/^\s{2,}\S/.test(current)) break;
      cluster.push(current);
      i += 1;
    }

    const bulletCount = cluster.filter((entry) => BULLET_RE.test(entry)).length;
    const orderedCount = cluster.filter((entry) => ORDERED_RE.test(entry)).length;
    if (cluster.length === 0 || bulletCount === 0 || orderedCount === 0) {
      if (cluster.length > 0) out.push(...cluster);
      else {
        out.push(line);
        i = start + 1;
      }
      continue;
    }

    const normalizedCluster = cluster.map((entry) => {
      const ordered = entry.match(ORDERED_RE);
      if (!ordered) return entry;
      const indent = ordered[1] ?? "";
      const body = ordered[2] ?? "";
      return `${indent}- ${body}`;
    });

    out.push(...normalizedCluster);
  }

  return out.join("\n");
}

export const mixedListStabilization = {
  id: "mixed-list-stabilization",
  order: 1575,
  apply(text: string, _ctx: NormalizeContext): string {
    return transformUnprotected(text, normalizeMixedListClusters);
  },
};

registerRules(mixedListStabilization);
