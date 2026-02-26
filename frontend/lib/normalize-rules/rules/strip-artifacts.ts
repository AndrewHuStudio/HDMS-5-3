/**
 * Rules: strip-think-tags, strip-zero-width
 *
 * Remove leaked <think>/<\/think> tags and zero-width Unicode characters
 * that break markdown rendering.
 *
 * Backend rendering removed — this is now the sole handler.
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";

export const stripThinkTags = {
  id: "strip-think-tags",
  order: 100,
  apply(text: string, _ctx: NormalizeContext): string {
    return text.replace(/<\/?think>/gi, "");
  },
};

export const stripZeroWidth = {
  id: "strip-zero-width",
  order: 101,
  apply(text: string, _ctx: NormalizeContext): string {
    return text.replace(/[\u200B-\u200D\uFEFF]/g, "");
  },
};

registerRules(stripThinkTags, stripZeroWidth);
