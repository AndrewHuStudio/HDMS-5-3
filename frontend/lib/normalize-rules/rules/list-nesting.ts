/**
 * 规则：list-nesting
 *
 * 将紧跟在有序列表项后的“顶格 bullet”修复为该编号项下的嵌套子列表，
 * 解决 LLM 常见输出：
 *
 * 1. 父项
 * - 子项
 * - 子项
 * 1. 下一个父项
 *
 * 被 Markdown 解析成多个顶级列表的问题。
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";

const ORDERED_ITEM_RE = /^(\s{0,3})(\d+)([.)．])\s+(.+)$/;
const BULLET_ITEM_RE = /^(\s*)([-*+•·])\s+(.+)$/;
const HEADING_RE = /^\s*#{1,6}\s+\S/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const TABLEISH_RE = /^\s*\|.+\|\s*$/;

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim());
}

function isOrderedItem(line: string): boolean {
  return ORDERED_ITEM_RE.test(line);
}

function isBulletItem(line: string): boolean {
  return BULLET_ITEM_RE.test(line);
}

function isHardBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return (
    HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    TABLEISH_RE.test(line) ||
    isTableSeparator(line)
  );
}

function normalizeOrderedChildBullets(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    out.push(line);

    const orderedMatch = line.match(ORDERED_ITEM_RE);
    if (!orderedMatch) {
      i += 1;
      continue;
    }

    const parentIndent = orderedMatch[1] ?? "";
    const nestedIndent = `${parentIndent}    `;

    let j = i + 1;
    let sawNestedChild = false;

    while (j < lines.length) {
      const nextLine = lines[j] ?? "";
      const trimmed = nextLine.trim();

      if (!trimmed) {
        out.push(nextLine);
        j += 1;
        continue;
      }

      if (isHardBoundary(nextLine)) break;

      if (isOrderedItem(nextLine)) break;

      const bulletMatch = nextLine.match(BULLET_ITEM_RE);
      if (!bulletMatch) break;

      const bulletIndent = bulletMatch[1] ?? "";
      const bulletMarker = (bulletMatch[2] === "•" || bulletMatch[2] === "·")
        ? "-"
        : (bulletMatch[2] ?? "-");
      const bulletBody = bulletMatch[3] ?? "";

      if (bulletIndent.length > parentIndent.length) {
        out.push(nextLine);
        sawNestedChild = true;
        j += 1;
        continue;
      }

      out.push(`${nestedIndent}${bulletMarker} ${bulletBody}`);
      sawNestedChild = true;
      j += 1;
    }

    if (sawNestedChild) {
      const nextNonEmptyLine = lines.slice(j).find((candidate) => (candidate ?? "").trim());
      if (nextNonEmptyLine && isOrderedItem(nextNonEmptyLine)) {
        const previousOutLine = out[out.length - 1] ?? "";
        if (previousOutLine.trim()) {
          out.push("");
        }
      }
      i = j;
      continue;
    }

    i += 1;
  }

  return out.join("\n");
}

export const listNesting = {
  id: "list-nesting",
  order: 1550,
  apply(text: string, _ctx: NormalizeContext): string {
    return normalizeOrderedChildBullets(text);
  },
};

registerRules(listNesting);
