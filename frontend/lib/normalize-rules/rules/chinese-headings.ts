/**
 * 规则：chinese-headings
 *
 * 将中文风格标题（一、标题 / （一）标题 / 1. 标题 / 1) 标题 / ① 标题）
 * 转换为 Markdown 标题，使用标题分类器判断是否为真正的标题。
 */

import {
  classifyHeadingCandidate,
  parseMarkdownBlocks,
} from "@/features/qa/formatting";
import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { recordHeadingDecision } from "../utils";

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

const CN_H1_RE = /^(?:\*{2})?\s*([一二三四五六七八九十]+)[、.．]\s*(.+?)(?:\*{2})?\s*$/;
const CN_H2_RE = /^(?:\*{2})?\s*[（(]\s*([一二三四五六七八九十]+)\s*[)）]\s*(.+?)(?:\*{2})?\s*$/;
const NUM_H2_RE = /^\s*(\d{1,2})[.、．]\s*(.+?)\s*$/;
const CN_H3_RE = /^(?:\*{2})?\s*(\d+)[)）]\s*(.+?)(?:\*{2})?\s*$/;
const CIRCLED_H3_RE = /^(?:\*{2})?\s*([\u2460-\u2469])\s*(.+?)(?:\*{2})?\s*$/;
const DECIMAL_SECTION_RE =
  /^(?:\*{2})?\s*[.。]?\s*(\d{1,2}(?:\.\d{1,2}){1,3})\s*(.+?)(?:\*{2})?\s*$/;
const BULLET_LINE_RE = /^\s{0,3}[-*+]\s+/;
const ORDERED_LIST_LINE_RE = /^\s{0,3}\d+[.)．、]\s+/;
const MARKDOWN_HEADING_LINE_RE = /^\s*#{1,6}\s+\S/;

export const chineseHeadings = {
  id: "chinese-headings",
  order: 1000,
  apply(text: string, ctx: NormalizeContext): string {
    const lines = text.split("\n");
    const headingCandidates = collectHeadingCandidateLineIndexes(text);
    const result: string[] = [];

    const prevNonEmptyLine = (idx: number): string | null => {
      for (let i = idx - 1; i >= 0; i--) {
        const t = lines[i]?.trim();
        if (t) return t;
      }
      return null;
    };

    const nextNonEmptyLine = (idx: number): string | null => {
      for (let i = idx + 1; i < lines.length; i++) {
        const t = lines[i]?.trim();
        if (t) return t;
      }
      return null;
    };

    const isLikelyListHeadingLeadIn = (idx: number, title: string): boolean => {
      const normalized = String(title || "").trim();
      const normalizedWithoutTrailingCitations = normalized
        .replace(/(?:\s*\[\d{1,2}-\d{1,2}\]\s*)+$/g, "")
        .replace(/(?:\s*\[\d{1,2}-\d{1,2}\]\(#source-[^)]+\)\s*)+$/g, "")
        .trim();
      const next = nextNonEmptyLine(idx) || "";
      const followedByList = BULLET_LINE_RE.test(next) || ORDERED_LIST_LINE_RE.test(next);
      const followedByTable = /^\s*\|.+\|\s*$/.test(next);
      if (followedByTable && /[：:]$/.test(normalizedWithoutTrailingCitations)) return true;
      if (!followedByList) return false;
      if (/[：:]$/.test(normalizedWithoutTrailingCitations)) return true;
      // Numbered lead-in lines followed by list blocks are usually list items
      // instead of real headings, even without a trailing colon.
      if (
        normalizedWithoutTrailingCitations.length <= 40 &&
        !/[。！？.!?；;]$/.test(normalizedWithoutTrailingCitations)
      ) {
        return true;
      }
      return false;
    };

    const isLikelyNestedSectionLeadIn = (idx: number): boolean => {
      const prev = prevNonEmptyLine(idx) || "";
      const next = nextNonEmptyLine(idx) || "";
      const followedByStructuredBlock =
        BULLET_LINE_RE.test(next) ||
        ORDERED_LIST_LINE_RE.test(next) ||
        /^\s*\|.+\|\s*$/.test(next);
      if (!followedByStructuredBlock) return false;
      return MARKDOWN_HEADING_LINE_RE.test(prev);
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx] ?? "";
      const trimmed = line.trim();

      if (!trimmed || /^#{1,6}\s/.test(trimmed)) {
        result.push(line);
        continue;
      }

      if (!headingCandidates.has(idx)) {
        result.push(line);
        continue;
      }

      // Level-1: 一、标题
      let match = trimmed.match(CN_H1_RE);
      if (match) {
        if (isLikelyNestedSectionLeadIn(idx)) {
          result.push(line);
          continue;
        }
        const candidate = `${match[1]}\u3001${match[2].trim()}`;
        const classification = classifyHeadingCandidate(candidate, {
          previousNonEmptyLine: prevNonEmptyLine(idx) || "",
          nextNonEmptyLine: nextNonEmptyLine(idx) || "",
          lineIndex: idx,
          totalLines: lines.length,
        });
        recordHeadingDecision(ctx.diagnostics, classification.decision, classification.reasons);
        if (classification.decision !== "heading") {
          result.push(line);
          continue;
        }
        result.push(`## ${match[1]}\u3001${match[2].trim()}`);
        continue;
      }

      // Level-2: （一）标题
      match = trimmed.match(CN_H2_RE);
      if (match) {
        const candidate = `\uFF08${match[1]}\uFF09${match[2].trim()}`;
        const classification = classifyHeadingCandidate(candidate, {
          previousNonEmptyLine: prevNonEmptyLine(idx) || "",
          nextNonEmptyLine: nextNonEmptyLine(idx) || "",
          lineIndex: idx,
          totalLines: lines.length,
        });
        recordHeadingDecision(ctx.diagnostics, classification.decision, classification.reasons);
        if (classification.decision !== "heading") {
          result.push(line);
          continue;
        }
        result.push(`### \uFF08${match[1]}\uFF09${match[2].trim()}`);
        continue;
      }

      // Level-2 alt: "1. 标题" / "1、标题"
      match = trimmed.match(NUM_H2_RE);
      if (match) {
        const title = match[2].trim();
        if (isLikelyListHeadingLeadIn(idx, title)) {
          result.push(line);
          continue;
        }
        const classification = classifyHeadingCandidate(`${match[1]}. ${title}`, {
          previousNonEmptyLine: prevNonEmptyLine(idx) || "",
          nextNonEmptyLine: nextNonEmptyLine(idx) || "",
          lineIndex: idx,
          totalLines: lines.length,
        });
        recordHeadingDecision(ctx.diagnostics, classification.decision, classification.reasons);
        if (classification.decision === "heading") {
          result.push(`### ${match[1]}. ${title}`);
          continue;
        }
      }

      // Level-3: 1) 标题
      match = trimmed.match(CN_H3_RE);
      if (match) {
        const candidate = `${match[1]}) ${match[2].trim()}`;
        const classification = classifyHeadingCandidate(candidate, {
          previousNonEmptyLine: prevNonEmptyLine(idx) || "",
          nextNonEmptyLine: nextNonEmptyLine(idx) || "",
          lineIndex: idx,
          totalLines: lines.length,
        });
        recordHeadingDecision(ctx.diagnostics, classification.decision, classification.reasons);
        if (classification.decision !== "heading") {
          result.push(line);
          continue;
        }
        result.push(`#### ${match[1]}) ${match[2].trim()}`);
        continue;
      }

      // Level-3: ① 标题
      match = trimmed.match(CIRCLED_H3_RE);
      if (match) {
        const candidate = `${match[1]} ${match[2].trim()}`;
        const classification = classifyHeadingCandidate(candidate, {
          previousNonEmptyLine: prevNonEmptyLine(idx) || "",
          nextNonEmptyLine: nextNonEmptyLine(idx) || "",
          lineIndex: idx,
          totalLines: lines.length,
        });
        recordHeadingDecision(ctx.diagnostics, classification.decision, classification.reasons);
        if (classification.decision !== "heading") {
          result.push(line);
          continue;
        }
        result.push(`#### ${match[1]} ${match[2].trim()}`);
        continue;
      }

      // Decimal section: "3.2.1 标题"
      match = trimmed.match(DECIMAL_SECTION_RE);
      if (match) {
        const sectionNumber = match[1].trim();
        const title = match[2].trim();
        if (title && !title.includes("|") && /[\u4e00-\u9fffA-Za-z]/.test(title)) {
          const classification = classifyHeadingCandidate(`${sectionNumber} ${title}`, {
            previousNonEmptyLine: prevNonEmptyLine(idx) || "",
            nextNonEmptyLine: nextNonEmptyLine(idx) || "",
            lineIndex: idx,
            totalLines: lines.length,
          });
          recordHeadingDecision(ctx.diagnostics, classification.decision, classification.reasons);
          if (classification.decision === "heading") {
            const depth = sectionNumber.split(".").length;
            const level = Math.min(6, Math.max(3, depth + 1));
            result.push(`${"#".repeat(level)} ${sectionNumber} ${title}`);
            continue;
          }
        }
      }

      result.push(line);
    }

    return result.join("\n");
  },
};

registerRules(chineseHeadings);
