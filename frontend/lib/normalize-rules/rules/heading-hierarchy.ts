/**
 * 规则：heading-hierarchy
 *
 * 规范化 Markdown 标题层级和间距，使用标题分类器将类句子的伪标题降级为普通文本。
 * 确保标题层级不跳级（如 ## 后直接 ####），主要章节标题统一为 ##。
 */

import {
  classifyHeadingCandidate,
  parseMarkdownBlocks,
} from "@/features/qa/formatting";
import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { recordHeadingDecision } from "../utils";
import { MAJOR_SECTION_TITLE_RE, normalizeHeadingTitle } from "./related-concepts";

const HEADING_LINE_RE = /^(#{1,6})\s*(.*?)\s*$/;

function collectHeadingCandidateLineIndexes(text: string): Set<number> {
  const blocks = parseMarkdownBlocks(text);
  const indexes = new Set<number>();
  for (const block of blocks) {
    if (block.type !== "heading_candidate") continue;
    if (block.startLine !== block.endLine) continue;
    indexes.add(block.startLine);
  }
  return indexes;
}

export const headingHierarchy = {
  id: "heading-hierarchy",
  order: 1200,
  apply(text: string, ctx: NormalizeContext): string {
    const lines = text.split("\n");
    const headingCandidates = collectHeadingCandidateLineIndexes(text);
    if (headingCandidates.size === 0) return text;

    const findPreviousNonEmptyLine = (idx: number): string => {
      for (let i = idx - 1; i >= 0; i--) {
        const candidate = lines[i]?.trim();
        if (candidate) return candidate;
      }
      return "";
    };

    const findNextNonEmptyLine = (idx: number): string => {
      for (let i = idx + 1; i < lines.length; i++) {
        const candidate = lines[i]?.trim();
        if (candidate) return candidate;
      }
      return "";
    };

    const normalized = lines.map((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (!headingCandidates.has(idx)) return line;

      const match = trimmed.match(HEADING_LINE_RE);
      if (!match) return line;

      const originalLevel = match[1].length;
      const rawTitle = (match[2] || "").trim();
      const semanticTitle = normalizeHeadingTitle(rawTitle);
      if (!semanticTitle) return "";

      const isExplicitMarkdownHeading = /^#{1,6}\s+/.test(trimmed);
      if (isExplicitMarkdownHeading) {
        let level = originalLevel;
        if (MAJOR_SECTION_TITLE_RE.test(semanticTitle)) level = 2;
        level = Math.max(2, Math.min(6, level));
        recordHeadingDecision(ctx.diagnostics, "heading", ["explicit-markdown-heading"]);
        return `${"#".repeat(level)} ${rawTitle}`;
      }

      const classification = classifyHeadingCandidate(semanticTitle, {
        previousNonEmptyLine: findPreviousNonEmptyLine(idx),
        nextNonEmptyLine: findNextNonEmptyLine(idx),
        lineIndex: idx,
        totalLines: lines.length,
      });
      recordHeadingDecision(ctx.diagnostics, classification.decision, classification.reasons);

      if (classification.decision !== "heading") return semanticTitle;

      let level = originalLevel;
      if (MAJOR_SECTION_TITLE_RE.test(semanticTitle)) level = 2;
      level = Math.max(2, Math.min(6, level));
      return `${"#".repeat(level)} ${rawTitle}`;
    });

    const out: string[] = [];
    let prevHeadingLevel = 0;
    for (let idx = 0; idx < normalized.length; idx++) {
      const line = normalized[idx] ?? "";
      if (!headingCandidates.has(idx)) {
        out.push(line);
        continue;
      }
      const trimmed = line.trim();
      const match = trimmed.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (!match) {
        out.push(line);
        continue;
      }

      let level = match[1].length;
      const title = match[2];
      if (prevHeadingLevel > 0 && level > prevHeadingLevel + 1) {
        level = prevHeadingLevel + 1;
      }
      if (level < 2) level = 2;

      out.push(`${"#".repeat(level)} ${title}`);
      prevHeadingLevel = level;
    }

    return out.join("\n");
  },
};

registerRules(headingHierarchy);
