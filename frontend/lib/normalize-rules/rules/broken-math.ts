/**
 * 规则：broken-inline-math
 *
 * 轻量修复损坏的内联数学定界符。仅在 $...$ 区间明显损坏时介入：
 * - 花括号不平衡
 * - 包含标题标记
 * - 多行且花括号不平衡
 * 将损坏的 LaTeX 片段净化为纯文本。
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";

function hasBalancedBraces(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function sanitizeBrokenLatexFragment(fragment: string): string {
  let out = fragment;

  out = out.replace(/\\text\{([^{}]*)\}/g, "$1");
  out = out.replace(/\\text\(([^()]*)\)/g, "$1");
  out = out.replace(/\\text\{([^{}\n]+)(?=\n|$)/g, "$1");

  out = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2");

  out = out
    .replace(/\\geq/g, "\u2265")
    .replace(/\\leq/g, "\u2264")
    .replace(/\\times/g, "\u00D7")
    .replace(/\\cdot/g, "\u00B7");

  out = out.replace(/\\[A-Za-z]+/g, "");
  out = out.replace(/[{}]/g, "");

  out = out.replace(/[\u2212\u2014]/g, "-");
  out = out.replace(/\s*---+\s*/g, " ");

  out = out
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*([：:])\s*/g, "$1")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  out = out
    .replace(/\bG\s*B\s*\/\s*T\s*(\d{4,6})\s*-\s*(\d{4})\b/gi, "GB/T$1-$2")
    .replace(/\bG\s*B\s*\/\s*T\b/gi, "GB/T");

  return out;
}

export const brokenInlineMath = {
  id: "broken-inline-math",
  order: 2300,
  apply(text: string, _ctx: NormalizeContext): string {
    let out = "";
    let idx = 0;

    while (idx < text.length) {
      const ch = text[idx];

      if (ch === "$" && text[idx + 1] === "$") {
        const closeIdx = text.indexOf("$$", idx + 2);
        if (closeIdx >= 0) {
          out += text.slice(idx, closeIdx + 2);
          idx = closeIdx + 2;
        } else {
          out += "$$";
          idx += 2;
        }
        continue;
      }

      if (ch !== "$") {
        out += ch;
        idx += 1;
        continue;
      }

      if (idx > 0 && text[idx - 1] === "\\") {
        out += ch;
        idx += 1;
        continue;
      }

      let end = idx + 1;
      let found = -1;
      while (end < text.length) {
        if (text[end] === "$" && text[end + 1] !== "$" && text[end - 1] !== "\\") {
          found = end;
          break;
        }
        end += 1;
      }

      if (found < 0) {
        out += ch;
        idx += 1;
        continue;
      }

      const inner = text.slice(idx + 1, found);

      const hasBrokenHeading = /#{2,}/.test(inner);
      const multilineAndUnbalanced = inner.includes("\n") && !hasBalancedBraces(inner);

      if (hasBrokenHeading || multilineAndUnbalanced) {
        out += sanitizeBrokenLatexFragment(inner);
      } else {
        out += `$${inner}$`;
      }

      idx = found + 1;
    }

    if (out !== text) {
      out = out.replace(/([^\n#])\s*(#{2,6}\s*[\u4E00-\u4E5D\u5341\u767E0-9]+[、.．])/g, "$1\n$2");
      out = out.replace(/^[ \t]*#{2,6}[ \t]*$/gm, "");
      out = out.replace(/\n{3,}/g, "\n\n");
    }

    return out;
  },
};

registerRules(brokenInlineMath);
