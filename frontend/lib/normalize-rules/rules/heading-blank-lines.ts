/**
 * Rules: heading-blank-lines, list-blank-lines
 *
 * Ensure proper blank lines after headings and before list items
 * so markdown parsers treat them as separate blocks.
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";

export const headingBlankLines = {
  id: "heading-blank-lines",
  order: 1400,
  apply(text: string, _ctx: NormalizeContext): string {
    return text.replace(/^(#{1,6}\s+.+)\n(?!\s*$)/gm, "$1\n\n");
  },
};

export const listBlankLines = {
  id: "list-blank-lines",
  order: 1401,
  apply(text: string, _ctx: NormalizeContext): string {
    return text.replace(
      /^([ \t]*(?![-*+]\s)(?!\d+[.)]\s)\S[^\n]*)\n([ \t]*(?:[-*+]|\d+[.)])\s)/gm,
      "$1\n\n$2",
    );
  },
};

registerRules(headingBlankLines, listBlankLines);
