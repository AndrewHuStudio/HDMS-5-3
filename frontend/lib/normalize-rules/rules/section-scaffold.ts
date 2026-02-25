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

registerRules(sectionScaffold, headingSequence);
