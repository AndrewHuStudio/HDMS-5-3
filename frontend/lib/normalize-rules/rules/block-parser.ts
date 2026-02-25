/**
 * Rule: block-parser
 *
 * Parse text into structural blocks (code/math/table/heading/list/paragraph)
 * and serialize back. This normalizes whitespace and block boundaries.
 */

import {
  parseMarkdownBlocks,
  serializeMarkdownBlocks,
} from "@/features/qa/formatting";
import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { bumpCounter } from "../utils";

export const blockParser = {
  id: "block-parser",
  order: 300,
  apply(text: string, ctx: NormalizeContext): string {
    const blocks = parseMarkdownBlocks(text);
    if (ctx.diagnostics.enabled) {
      bumpCounter(ctx.diagnostics, "block-total", blocks.length);
      for (const block of blocks) {
        bumpCounter(ctx.diagnostics, `block-${block.type}`);
      }
    }
    return serializeMarkdownBlocks(blocks);
  },
};

registerRules(blockParser);
