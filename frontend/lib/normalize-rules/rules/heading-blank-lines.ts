/**
 * 规则：heading-blank-lines, list-blank-lines
 *
 * 确保标题后和列表前有适当的空行，使 Markdown 解析器将它们视为独立块。
 * heading-blank-lines: 标题后添加空行
 * list-blank-lines: 列表前添加空行
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
