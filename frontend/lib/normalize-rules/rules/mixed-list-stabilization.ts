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
const NESTED_CONTENT_RE = /^\s{4,}\S/;

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
    const nestedContentCount = cluster.filter((entry) => NESTED_CONTENT_RE.test(entry)).length;
    const leadingOrderedCount = cluster.filter((entry) => {
      const ordered = entry.match(ORDERED_RE);
      if (!ordered) return false;
      const indent = ordered[1] ?? "";
      return indent.length === 0;
    }).length;
    const topLevelBulletCount = cluster.filter((entry) => {
      const bullet = entry.match(BULLET_RE);
      if (!bullet) return false;
      const indent = bullet[1] ?? "";
      return indent.length === 0;
    }).length;

    if (cluster.length === 0 || bulletCount === 0 || orderedCount === 0) {
      if (cluster.length > 0) out.push(...cluster);
      else {
        out.push(line);
        i = start + 1;
      }
      continue;
    }

    // Preserve legitimate ordered parents with nested children. These are the
    // exact structures produced by list-numbering/list-nesting and should not
    // be flattened back into bullets during final stabilization.
    if (topLevelBulletCount === 0 && (nestedContentCount > 0 || leadingOrderedCount >= 1)) {
      out.push(...cluster);
      continue;
    }

    // Preserve "bullet lead-in + ordered parent items" structures. These are
    // used in QA answers to introduce a checklist, and flattening them back to
    // bullets destroys the intended parent numbering.
    const firstTopLevelEntry = cluster.find((entry) => entry.trim().length > 0) ?? "";
    const startsWithTopLevelBullet = BULLET_RE.test(firstTopLevelEntry);
    if (
      startsWithTopLevelBullet &&
      leadingOrderedCount > 0 &&
      nestedContentCount > 0
    ) {
      out.push(...cluster);
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
