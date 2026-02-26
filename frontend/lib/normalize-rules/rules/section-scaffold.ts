/**
 * Rules: section-scaffold, heading-sequence
 *
 * Inject stable two-layer scaffold (## 检索综述 / ## 详细解析) when only
 * level-3 headings exist, and fix repeated heading numbering.
 */

import {
  parseMarkdownBlocks,
} from "@/features/qa/formatting";
import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";

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

/**
 * Idempotent guard: keep only the first `## 检索综述` heading.
 * Runs in final phase as a fallback — the backend has its own guard,
 * but streaming tokens may bypass it if the LLM regenerates the heading.
 */
export const dedupeRetrievalOverview = {
  id: "dedupe-retrieval-overview",
  order: 1750,
  apply(text: string, _ctx: NormalizeContext): string {
    const re = /^##\s+检索综述\s*[:：]?\s*$/gm;
    let first = true;
    return text.replace(re, (match) => {
      if (first) {
        first = false;
        return match;
      }
      return "";
    });
  },
};

const RETRIEVAL_OVERVIEW_HEADING_RE = /^##\s+检索综述\s*[:：]?\s*$/;
const RETRIEVAL_STATUS_LINE_RE = /^已检索\s*\d+\s*条候选\s*[，,]\s*融合\s*\d+\s*条结果[。.]?\s*$/;
const H2_HEADING_RE = /^##\s+\S/;

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

/**
 * Keep retrieval overview minimal:
 * - drop "已检索 x 条候选，融合 y 条结果"
 * - keep only blockquote-based retrieval container lines under "## 检索综述"
 * - if no following H2 exists, preserve removed body by migrating it to "## 详细解析"
 */
export const retrievalOverviewCleanup = {
  id: "retrieval-overview-cleanup",
  order: 1760,
  apply(text: string, _ctx: NormalizeContext): string {
    const lines = text.split("\n");
    const out: string[] = [];
    let changed = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!RETRIEVAL_OVERVIEW_HEADING_RE.test(trimmed)) {
        out.push(line);
        continue;
      }

      out.push(line);

      const sectionLines: string[] = [];
      while (i + 1 < lines.length && !H2_HEADING_RE.test(lines[i + 1].trim())) {
        i += 1;
        sectionLines.push(lines[i]);
      }
      const hasFollowingH2 = i + 1 < lines.length && H2_HEADING_RE.test(lines[i + 1].trim());

      const hasQuoteContainer = sectionLines.some((entry) => /^\s*>/.test(entry));

      if (!hasQuoteContainer) {
        for (const entry of sectionLines) {
          if (RETRIEVAL_STATUS_LINE_RE.test(entry.trim())) {
            changed = true;
            continue;
          }
          out.push(entry);
        }
      } else {
        const detailRemainder: string[] = [];
        for (const entry of sectionLines) {
          const entryTrimmed = entry.trim();
          if (!entryTrimmed) {
            if (out.length > 0 && out[out.length - 1].trim()) out.push(entry);
            continue;
          }
          if (RETRIEVAL_STATUS_LINE_RE.test(entryTrimmed)) {
            changed = true;
            continue;
          }
          if (/^\s*>/.test(entry)) {
            out.push(entry);
            continue;
          }
          detailRemainder.push(entry);
          changed = true;
        }
        while (out.length > 0 && !out[out.length - 1].trim()) out.pop();

        if (!hasFollowingH2) {
          const migrated = trimBlankEdges(detailRemainder);
          if (migrated.length > 0) {
            if (out.length > 0 && out[out.length - 1].trim()) out.push("");
            if (!H2_HEADING_RE.test(migrated[0].trim())) {
              out.push("## 详细解析", "");
            }
            out.push(...migrated);
          }
        }
      }

      if (hasFollowingH2) {
        while (out.length > 0 && !out[out.length - 1].trim()) out.pop();
        if (out.length > 0 && out[out.length - 1].trim()) out.push("");
      }
    }

    while (out.length > 0 && !out[out.length - 1].trim()) out.pop();
    return changed ? out.join("\n") : text;
  },
};

export const sectionScaffold = {
  id: "section-scaffold",
  order: 1800,
  apply(text: string, _ctx: NormalizeContext): string {
    const lines = text.split("\n");
    const hasH2 = lines.some((line) => /^##\s+/.test(line.trim()));
    if (hasH2) return text;

    const firstDetailedHeadingIndex = lines.findIndex((line) => {
      const t = line.trim();
      if (!/^###\s+/.test(t)) return false;
      return (
        /^###\s+\d{1,2}[.、．]\s+/.test(t) ||
        /^###\s+[（(][一二三四五六七八九十]+[)）]/.test(t)
      );
    });

    if (firstDetailedHeadingIndex <= 0) return text;

    const summary = lines.slice(0, firstDetailedHeadingIndex).join("\n").trim();
    const detailed = lines.slice(firstDetailedHeadingIndex).join("\n").trim();

    if (!detailed) return text;

    const out: string[] = [];
    if (summary) {
      out.push("## \u68C0\u7D22\u7EFC\u8FF0", "", summary, "");
    }
    out.push("## \u8BE6\u7EC6\u89E3\u6790", "", detailed);

    return out.join("\n");
  },
};

export const headingSequence = {
  id: "heading-sequence",
  order: 1900,
  apply(text: string, _ctx: NormalizeContext): string {
    const lines = text.split("\n");
    const headingCandidates = collectHeadingCandidateLineIndexes(text);
    let changed = false;
    let blockStart = -1;
    let blockMatches: Array<{ index: number; title: string; number: number }> = [];

    const normalizeBlock = () => {
      if (blockMatches.length < 2) return;
      const nums = blockMatches.map((item) => item.number);
      const hasDuplicate = new Set(nums).size !== nums.length;
      const isSequentialFromOne = nums.every((n, idx) => n === idx + 1);
      if (!hasDuplicate && isSequentialFromOne) return;
      blockMatches.forEach((item, idx) => {
        lines[item.index] = `### ${idx + 1}. ${item.title}`;
      });
      changed = true;
    };

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]?.trim() || "";
      const isMajorHeading = /^##\s+/.test(trimmed);
      if (isMajorHeading) {
        normalizeBlock();
        blockMatches = [];
        blockStart = i;
        continue;
      }

      const m = trimmed.match(/^###\s+(\d{1,2})[.、．]\s+(.+?)\s*$/);
      if (!m) continue;
      if (!headingCandidates.has(i)) continue;

      if (blockStart === -1) blockStart = 0;
      blockMatches.push({ index: i, title: m[2].trim(), number: Number(m[1]) });
    }

    normalizeBlock();

    return changed ? lines.join("\n") : text;
  },
};

registerRules(dedupeRetrievalOverview, retrievalOverviewCleanup, sectionScaffold, headingSequence);
