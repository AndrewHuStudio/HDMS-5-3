/**
 * 规则：conclusion-heading
 *
 * 将 "核心结论：" / "结论：" 标记提升为顶级章节标题（## 结论），
 * 使其与 "检索综述/详细解析" 处于同一层级。
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { INLINE_OR_FENCED_CODE_RE } from "../utils";

export const conclusionHeading = {
  id: "conclusion-heading",
  order: 2100,
  apply(text: string, _ctx: NormalizeContext): string {
    if (!text) return text;

    if (/^##\s*(?:核心结论|结论|总结|小结)\b/m.test(text)) return text;

    const segments = text.split(INLINE_OR_FENCED_CODE_RE);
    let replaced = false;

    const markerRe =
      /(?:^|\n)([ \t]*)(?:[-*+]\s+)?(?:\*\*)?(核心结论|结论|总结|小结)(?:\*\*)?\s*[：:]\s*/;

    const inlineRe =
      /([。！？.!?])\s*(?:\*\*)?(核心结论|结论|总结|小结)(?:\*\*)?\s*[：:]\s*/;

    const normalizeSegment = (segment: string): string => {
      if (replaced) return segment;

      const m = segment.match(markerRe);
      if (m) {
        replaced = true;
        return segment.replace(markerRe, "\n\n## \u7ED3\u8BBA\n\n");
      }

      const im = segment.match(inlineRe);
      if (im) {
        replaced = true;
        return segment.replace(inlineRe, `$1\n\n## \u7ED3\u8BBA\n\n`);
      }

      return segment;
    };

    const out = segments
      .map((segment, idx) => (idx % 2 === 1 ? segment : normalizeSegment(segment)))
      .join("");

    return out;
  },
};

registerRules(conclusionHeading);
