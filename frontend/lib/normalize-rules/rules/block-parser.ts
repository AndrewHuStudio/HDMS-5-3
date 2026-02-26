/**
 * 规则：block-parser
 *
 * 将文本解析为结构化块（code/math/table/heading/list/paragraph），
 * 然后序列化回文本。这会规范化空白和块边界。
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
