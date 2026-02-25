/**
 * Rule: related-concepts-body
 *
 * Demote heading lines inside "## 相关概念" section to plain text
 * so the UI renders them as normal body font.
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";

const MAJOR_SECTION_TITLE_RE =
  /^(?:检索综述|详细解析|相关概念|核心结论|结论|总结|小结)(?:\s*[:：].*)?$/;

function stripInlineMdWrappers(value: string): string {
  let s = (value || "").trim();
  for (const wrapper of ["**", "__", "*", "_"]) {
    if (s.startsWith(wrapper) && s.endsWith(wrapper) && s.length > wrapper.length * 2) {
      s = s.slice(wrapper.length, -wrapper.length).trim();
    }
  }
  return s;
}

function normalizeHeadingTitle(value: string): string {
  return stripInlineMdWrappers((value || "").replace(/\u3000/g, " ").trim());
}

function stripQuotePrefix(value: string): string {
  let s = (value || "").trim();
  while (s.startsWith(">")) s = s.slice(1).trimStart();
  return s;
}

function extractMarkdownHeadingLoose(line: string): { level: number; title: string } | null {
  const s = stripQuotePrefix(line);
  const m = s.match(/^(#{1,6})\s*(.+?)\s*$/);
  if (!m) return null;
  return { level: m[1].length, title: m[2] };
}

export const relatedConceptsBody = {
  id: "related-concepts-body",
  order: 1100,
  apply(text: string, _ctx: NormalizeContext): string {
    const lines = text.split("\n");
    let inRelated = false;

    for (let idx = 0; idx < lines.length; idx++) {
      const raw = lines[idx] ?? "";
      const trimmed = raw.trim();
      const heading = extractMarkdownHeadingLoose(trimmed);
      const headingTitle = heading ? normalizeHeadingTitle(heading.title) : "";

      if (heading && heading.level === 2 && headingTitle.startsWith("\u76F8\u5173\u6982\u5FF5")) {
        inRelated = true;
        continue;
      }

      if (!inRelated || !trimmed) continue;

      if (heading && heading.level === 2 && MAJOR_SECTION_TITLE_RE.test(headingTitle)) {
        inRelated = false;
        continue;
      }

      if (heading) {
        lines[idx] = headingTitle;
        continue;
      }

      lines[idx] = stripQuotePrefix(raw);
    }

    return lines.join("\n");
  },
};

// Re-export shared helpers for heading-hierarchy rule
export {
  MAJOR_SECTION_TITLE_RE,
  normalizeHeadingTitle,
  stripQuotePrefix,
  extractMarkdownHeadingLoose,
};

registerRules(relatedConceptsBody);
