/**
 * Rule: formula-promotion
 *
 * Promote obvious bare formula lines to display-math blocks ($$...$$)
 * so they render with dedicated KaTeX styles.
 */

import {
  parseMarkdownBlocks,
} from "@/features/qa/formatting";
import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { bumpCounter } from "../utils";

const MARKDOWN_OR_HTML_IMAGE_RE = /(?:!\[[^\]\n]*\]\([^)\n]+\)|<img\b[^>]*>)/i;
const FORMULA_LATEX_TOKEN_RE =
  /\\(?:frac|sum|sqrt|times|cdot|geq|leq|approx|neq|text|max|min|int|prod|left|right|operatorname)\b/i;
const FORMULA_SENTENCE_PUNCT_RE = /[。！？；]/;
const FORMULA_OPERATOR_RE = /(?:=|>=|<=|>|<|≥|≤|\\geq|\\leq|\\approx|\\neq|[+\-*/×÷^])/;

function looksLikeBareFormulaExpression(value: string): boolean {
  const text = (value || "").trim();
  if (!text) return false;
  if (MARKDOWN_OR_HTML_IMAGE_RE.test(text)) return false;
  if (text.length < 6 || text.length > 220) return false;
  if (text.includes("|")) return false;
  if (FORMULA_SENTENCE_PUNCT_RE.test(text)) return false;
  if (/^\d+[.)]\s+/.test(text) || /^[-*+]\s+/.test(text) || /^#{1,6}\s+/.test(text)) return false;
  if (/\[\d{1,2}-\d{1,2}\]/.test(text)) return false;

  const hasLatex = FORMULA_LATEX_TOKEN_RE.test(text);
  const hasOperator = FORMULA_OPERATOR_RE.test(text);
  if (hasLatex && hasOperator) return true;

  const hasEquation = /[A-Za-z\u4e00-\u9fff]\s*=\s*[^\s]/.test(text);
  const hasArithmetic = /[+\-*/×÷]/.test(text);
  return hasEquation && hasArithmetic;
}

export const formulaPromotion = {
  id: "formula-promotion",
  order: 2000,
  apply(text: string, ctx: NormalizeContext): string {
    if (!text) return text;

    const blocks = parseMarkdownBlocks(text);
    let changed = false;

    const mapped = blocks.map((block) => {
      if (block.type !== "paragraph") return block.content;

      const lines = block.lines;
      const next: string[] = [];
      let blockChanged = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          next.push(line);
          continue;
        }

        if (/^\$\$/.test(trimmed) || /^\$[^$]+?\$$/.test(trimmed)) {
          next.push(line);
          continue;
        }

        const inlineSplit = trimmed.match(/^(.{1,28}[：:])\s*(.+)$/);
        if (inlineSplit && looksLikeBareFormulaExpression(inlineSplit[2])) {
          next.push(inlineSplit[1], "", "$$", inlineSplit[2].trim(), "$$");
          blockChanged = true;
          continue;
        }

        if (looksLikeBareFormulaExpression(trimmed)) {
          next.push("$$", trimmed, "$$");
          blockChanged = true;
          continue;
        }

        next.push(line);
      }

      if (blockChanged) {
        changed = true;
        bumpCounter(ctx.diagnostics, "promote-bare-formula-paragraph");
        return next.join("\n");
      }

      return block.content;
    });

    return changed ? mapped.join("\n") : text;
  },
};

registerRules(formulaPromotion);
