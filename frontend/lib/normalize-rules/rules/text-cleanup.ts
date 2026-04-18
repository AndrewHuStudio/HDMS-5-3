/**
 * 规则：fullwidth-asterisks, bold-whitespace, star-run-placeholders, unicode-bullets
 *
 * 文本级清理，仅在非保护区段（代码块外）操作：
 * - fullwidth-asterisks: 全角星号转半角
 * - bold-whitespace: 修复粗体标记内的多余空格
 * - star-run-placeholders: 将连续星号占位符替换为"相关资料"
 * - unicode-bullets: Unicode 项目符号转标准 Markdown 列表符号
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { transformUnprotected } from "../utils";

export const fullwidthAsterisks = {
  id: "fullwidth-asterisks",
  order: 600,
  apply(text: string, _ctx: NormalizeContext): string {
    return transformUnprotected(text, (seg) => seg.replace(/[＊∗﹡]/g, "*"));
  },
};

export const boldWhitespace = {
  id: "bold-whitespace",
  order: 601,
  apply(text: string, _ctx: NormalizeContext): string {
    return transformUnprotected(text, (seg) =>
      seg.replace(/\*\*\s+([^\n*]+?)\s+\*\*/g, "**$1**"),
    );
  },
};

export const starRunPlaceholders = {
  id: "star-run-placeholders",
  order: 602,
  apply(text: string, _ctx: NormalizeContext): string {
    return transformUnprotected(text, (seg) => {
      const lines = seg.split("\n");
      return lines
        .map((line) => {
          if (/^\s*\*{3,}\s*$/.test(line)) return line;
          return line.replace(/\*{4,}/g, "\u76F8\u5173\u8D44\u6599");
        })
        .join("\n");
    });
  },
};

export const unicodeBullets = {
  id: "unicode-bullets",
  order: 1300,
  apply(text: string, _ctx: NormalizeContext): string {
    return text.replace(/^([ \t]*)[•·]\s+/gm, "$1- ");
  },
};

registerRules(fullwidthAsterisks, boldWhitespace, starRunPlaceholders, unicodeBullets);
