/**
 * Rule: list-numbering
 *
 * Fix ordered list numbering so items under the same heading are
 * sequentially numbered (1. 2. 3.) instead of all being "1.".
 */

import {
  parseMarkdownBlocks,
} from "@/features/qa/formatting";
import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";

function normalizeListBlockContent(blockContent: string): string {
  const lines = blockContent.split(/\r?\n/);
  let activeIndent = "";
  let orderedCounter = 0;
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

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      const sectionBreak =
        /^#{1,6}\s+/.test(trimmed) ||
        /^[-*_]{3,}$/.test(trimmed) ||
        /^\*\*.+\*\*$/.test(trimmed);
      if (sectionBreak) {
        orderedCounter = 0;
        activeIndent = "";
      }

      const orderedMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
      if (orderedMatch) {
        const indent = orderedMatch[1] ?? "";
        const body = orderedMatch[2] ?? "";
        const originalNum = parseInt(line.match(/^\s*(\d+)\./)?.[1] ?? "1", 10);

        if (indent === activeIndent && orderedCounter > 0) {
          orderedCounter += 1;
        } else {
          orderedCounter = 1;
          activeIndent = indent;
        }

        if (originalNum > 1 && Math.abs(originalNum - orderedCounter) > 2) {
          orderedCounter = originalNum;
          return line;
        }

        return `${indent}${orderedCounter}. ${body}`;
      }

      const bulletMatch = line.match(/^(\s*)[-*+]\s+/);
      if (bulletMatch) {
        const bulletIndent = bulletMatch[1] ?? "";
        if (orderedCounter > 0 && bulletIndent.length <= activeIndent.length) {
          const normalized = line.trimStart();
          return `${activeIndent}  ${normalized}`;
        }
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
}

/** Exported for external use (e.g. block parser). */
export function normalizeMarkdownLists(content: string): string {
  if (!content) return content;

  const blocks = parseMarkdownBlocks(content);
  let changed = false;
  const out = blocks.map((block) => {
    if (block.type !== "list") return block.content;
    const normalized = normalizeListBlockContent(block.content);
    if (normalized !== block.content) changed = true;
    return normalized;
  });

  return changed ? out.join("\n") : content;
}

export const listNumbering = {
  id: "list-numbering",
  order: 1500,
  apply(text: string, _ctx: NormalizeContext): string {
    return normalizeMarkdownLists(text);
  },
};

registerRules(listNumbering);
