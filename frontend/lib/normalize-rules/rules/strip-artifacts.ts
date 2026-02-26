/**
 * 规则：strip-think-tags, strip-zero-width
 *
 * 移除泄漏的 <think></think> 标签和零宽 Unicode 字符，避免破坏 Markdown 渲染。
 * 后端渲染已移除，现在由前端统一处理。
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
