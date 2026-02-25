/**
 * Rule: math-delimiters
 *
 * Frontend fallback for math delimiters:
 * - \[...\] -> $$...$$
 * - \(...\) -> $...$
 * - \$...\$ / \$\$...\$\$ -> $...$ / $$...$$
 *
 * Backend rendering removed — this is now the sole handler.
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { transformOutsideCodeAndDollarMath } from "../utils";

function normalizeMathDelimitersForRenderer(text: string): string {
  if (!text) return text;

  return transformOutsideCodeAndDollarMath(text, (segment) => {
    let out = segment;

    out = out
      .replace(/\\\\\[/g, "\\[")
      .replace(/\\\\\]/g, "\\]")
      .replace(/\\\\\(/g, "\\(")
      .replace(/\\\\\)/g, "\\)");

    out = out.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_m, inner: string) => `$$\n${inner.trim()}\n$$`);
    out = out.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_m, inner: string) => `$${inner.trim()}$`);

    out = out.replace(/\\\$\$([\s\S]*?)\\\$\$/g, (_m, inner: string) => `$$${inner}$$`);
    out = out.replace(/\\\$([\s\S]+?)\\\$/g, (_m, inner: string) => `$${inner}$`);

    return out;
  });
}

export const mathDelimiters = {
  id: "math-delimiters",
  order: 400,
  apply(text: string, _ctx: NormalizeContext): string {
    return normalizeMathDelimitersForRenderer(text);
  },
};

registerRules(mathDelimiters);
