/**
 * Rule: list-numbering
 *
 * Fix ordered list numbering so items under the same heading are
 * sequentially numbered (1. 2. 3.) instead of all being "1.".
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";

function normalizeListContent(content: string): string {
  const lines = content.split(/\r?\n/);
  let activeIndent = "";
  let orderedCounter = 0;
  let changed = false;

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

  const normalized = lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      const orderedMatch = line.match(/^(\s*)(\*{1,2})?\s*(\d+)([.)．])(\s*)(.+?)(?:\s*(\*{1,2}))?\s*$/);
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

      const sectionBreak =
        /^#{1,6}\s+/.test(trimmed) ||
        /^[-*_]{3,}$/.test(trimmed) ||
        /^\*\*.+\*\*$/.test(trimmed);
      if (sectionBreak) {
        orderedCounter = 0;
        activeIndent = "";
      }

      const bulletMatch = line.match(/^(\s*)[-*+]\s+/);
      if (bulletMatch) {
        return line;
      }

      if (orderedCounter > 0 && isOrderedListInterludeLine(trimmed)) {
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
