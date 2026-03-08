/**
 * 规则：list-numbering
 *
 * 修复有序列表编号，使同一标题下的列表项按顺序编号（1. 2. 3.），而非全部为 "1."。
 * 支持粗体包裹的列表项（**1. 内容**），跳过表格/图片/引用等插入内容。
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";

function normalizeListContent(content: string): string {
  const lines = content.split(/\r?\n/);
  let activeIndent = "";
  let orderedCounter = 0;
  let changed = false;

  const isSectionBreakLine = (trimmed: string): boolean =>
    /^#{1,6}\s+/.test(trimmed) ||
    /^[-*_]{3,}$/.test(trimmed) ||
    /^\*\*.+\*\*$/.test(trimmed);

  const isOrderedListInterludeLine = (trimmed: string): boolean => {
    const pipeCount = (trimmed.match(/\|/g) || []).length;
    return (
      /^[:：]\s*/.test(trimmed) ||
      /^!\[[^\]]*]\([^)]*\)/.test(trimmed) ||
      /^<img\b/i.test(trimmed) ||
      /^FIGCAPTION\b/i.test(trimmed) ||
      /^(?:相关示意图|示意图|附图|见图|图\d+)/.test(trimmed) ||
      /^\|.*\|$/.test(trimmed) ||
      pipeCount >= 2 ||
      /^>\s*/.test(trimmed)
    );
  };

  const isFormulaOrExplanatoryInterlude = (trimmed: string): boolean =>
    /^\$\$/.test(trimmed) ||
    /^\\\[$/.test(trimmed) ||
    /^\\\]$/.test(trimmed) ||
    /^(?:(?:where|wherein|note|notes)\b|式中|其中|注|说明)/i.test(trimmed);

  const orderedLineRe =
    /^(\s*)(\*{1,2})?\s*(\d+)([.)．])(\s*)(.+?)(?:\s*(\*{1,2}))?\s*$/;

  const hasUpcomingOrderedSibling = (lineIndex: number, indent: string): boolean => {
    const maxLookahead = Math.min(lines.length, lineIndex + 9);
    for (let i = lineIndex + 1; i < maxLookahead; i += 1) {
      const probeRaw = lines[i] ?? "";
      const probe = probeRaw.trim();
      if (!probe) continue;
      if (isSectionBreakLine(probe)) return false;

      const orderedProbe = probeRaw.match(orderedLineRe);
      if (orderedProbe) {
        return (orderedProbe[1] ?? "") === indent;
      }

      if (isOrderedListInterludeLine(probe) || isFormulaOrExplanatoryInterlude(probe)) {
        continue;
      }
    }
    return false;
  };

  const normalized = lines
    .map((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      const orderedMatch = line.match(orderedLineRe);
      if (orderedMatch) {
        const indent = orderedMatch[1] ?? "";
        const wrapperOpen = orderedMatch[2] ?? "";
        const originalNum = parseInt(orderedMatch[3] ?? "1", 10);
        const marker = (orderedMatch[4] ?? ".") as "." | ")" | "．";
        const spacingAfterMarker = orderedMatch[5] ?? "";
        const body = orderedMatch[6] ?? "";
        const wrapperClose = orderedMatch[7] ?? "";
        if (
          (wrapperOpen && wrapperClose && wrapperOpen !== wrapperClose) ||
          (!wrapperOpen && wrapperClose) ||
          (wrapperOpen && !wrapperClose)
        ) {
          return line;
        }
        if (!spacingAfterMarker && /^\d/.test(body)) {
          return line;
        }

        const sameTrack = indent === activeIndent && orderedCounter > 0;
        const expectedNum = sameTrack ? orderedCounter + 1 : 1;

        if (!sameTrack) {
          activeIndent = indent;
        }

        if (originalNum > 1 && Math.abs(originalNum - expectedNum) > 2) {
          orderedCounter = originalNum;
          return line;
        }

        orderedCounter = expectedNum;
        const rewritten = `${indent}${wrapperOpen}${orderedCounter}${marker} ${body}${wrapperClose}`;
        if (rewritten !== line) changed = true;
        return rewritten;
      }

      if (isSectionBreakLine(trimmed)) {
        orderedCounter = 0;
        activeIndent = "";
      }

      // Bullet lines (including unicode bullets •·) should not reset the counter.
      const bulletMatch = line.match(/^(\s*)[-*+•·]\s*/);
      if (bulletMatch) {
        return line;
      }

      if (
        orderedCounter > 0 &&
        (
          isOrderedListInterludeLine(trimmed) ||
          isFormulaOrExplanatoryInterlude(trimmed) ||
          hasUpcomingOrderedSibling(idx, activeIndent)
        )
      ) {
        return line;
      }

      if (/^\S/.test(line)) {
        orderedCounter = 0;
        activeIndent = "";
      }

      return line;
    })
    .join("\n");

  return changed ? normalized : content;
}

/** Exported for external use (e.g. block parser). */
export function normalizeMarkdownLists(content: string): string {
  if (!content) return content;
  return normalizeListContent(content);
}

export const listNumbering = {
  id: "list-numbering",
  order: 1500,
  apply(text: string, _ctx: NormalizeContext): string {
    return normalizeMarkdownLists(text);
  },
};

registerRules(listNumbering);
