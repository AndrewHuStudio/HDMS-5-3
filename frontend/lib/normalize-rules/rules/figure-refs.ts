/**
 * 规则：figure-refs, table-refs, section-artifacts
 *
 * figure-refs: 规范化图引用（"见图3.0.3" → "(见图1)"），按出现顺序重新编号
 * table-refs: 规范化表引用（"见表3.2.6" → "(见表1)"），按出现顺序重新编号
 * section-artifacts: 剥离章节编号噪声（如 "(3.2.1 说明)"），保留规范/标准上下文中的引用
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { transformUnprotected } from "../utils";

// Matches inline figure references like "见图3.0.3", "（见图3.0.1）", "如图2所示"
const FIGURE_REF_RE =
  /[（(]?\s*(?:(?:详见|参见|见|如)\s*)?图\s*(\d+(?:[.\-]\d+)*)\s*(?:所示|流程|示意|说明)?\s*[)）]?/g;

// Matches inline table references like "见表3.2.6", "（表4.4）", "如表2.1所示"
const TABLE_REF_RE =
  /[（(]?\s*(?:(?:详见|参见|见|如)\s*)?表\s*(\d+(?:[.\-]\d+)*)\s*(?:所示|详见|说明)?\s*[)）]?/g;

function normalizeFigureReferences(text: string): string {
  const allFigIds: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(FIGURE_REF_RE.source, FIGURE_REF_RE.flags);
  while ((m = re.exec(text)) !== null) {
    const figId = m[1];
    if (!seen.has(figId)) {
      seen.add(figId);
      allFigIds.push(figId);
    }
  }

  if (allFigIds.length === 0) return text;

  const figNumMap = new Map<string, number>();
  allFigIds.forEach((id, idx) => figNumMap.set(id, idx + 1));

  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const lineRefs: number[] = [];
    const lineRe = new RegExp(FIGURE_REF_RE.source, FIGURE_REF_RE.flags);
    let lm: RegExpExecArray | null;
    while ((lm = lineRe.exec(line)) !== null) {
      const num = figNumMap.get(lm[1]);
      if (num !== undefined && !lineRefs.includes(num)) {
        lineRefs.push(num);
      }
    }

    if (lineRefs.length === 0) {
      result.push(line);
      continue;
    }

    let cleaned = line.replace(new RegExp(FIGURE_REF_RE.source, FIGURE_REF_RE.flags), "");
    cleaned = cleaned.replace(/[（(]\s*[)）]/g, "");
    cleaned = cleaned.replace(/\s{2,}/g, " ");
    cleaned = cleaned.trimEnd();

    const refs = lineRefs.map((n) => `(见图${n})`).join("");
    result.push(`${cleaned}${refs}`);
  }

  return result.join("\n");
}

function normalizeTableReferences(text: string): string {
  const allTableIds: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TABLE_REF_RE.source, TABLE_REF_RE.flags);
  while ((m = re.exec(text)) !== null) {
    const tableId = m[1];
    if (!seen.has(tableId)) {
      seen.add(tableId);
      allTableIds.push(tableId);
    }
  }

  if (allTableIds.length === 0) return text;

  const tableNumMap = new Map<string, number>();
  allTableIds.forEach((id, idx) => tableNumMap.set(id, idx + 1));
  return text.replace(new RegExp(TABLE_REF_RE.source, TABLE_REF_RE.flags), (_raw, id: string) => {
    const n = tableNumMap.get(id);
    return n ? `(见表${n})` : "";
  });
}

function stripSectionNumberArtifacts(text: string): string {
  const SECTION_ARTIFACT_RE =
    /[（(]\s*\d+(?:\.\d+){1,4}(?:\s*(?:说明|详见|详述))?\s*[)）]/g;
  const LEGAL_CONTEXT_RE =
    /(GB\/T|GB\s*\/\s*T|CJJ|JGJ|规范|标准|条文|第\s*\d+\s*[条款节项]|见第\s*\d+\s*[条款节项])/i;
  const LIST_LINE_RE = /^(\s*)(?:[-*+]\s+|\d+[.)]\s+)/;

  const shouldPreserveArtifact = (segment: string, start: number, end: number): boolean => {
    const context = segment.slice(Math.max(0, start - 20), Math.min(segment.length, end + 20));
    return LEGAL_CONTEXT_RE.test(context);
  };

  const collapseIntraLineSpaces = (segment: string): string =>
    segment
      .split("\n")
      .map((line) => {
        if (!line.trim()) return line;
        const listMatch = line.match(LIST_LINE_RE);
        if (listMatch) {
          const indent = listMatch[1] ?? "";
          const rest = line.slice(indent.length);
          return indent + rest.replace(/[ \t]{2,}/g, " ");
        }
        return line.replace(/[ \t]{2,}/g, " ");
      })
      .join("\n");

  return transformUnprotected(text, (seg) =>
    collapseIntraLineSpaces(
      seg
      .replace(SECTION_ARTIFACT_RE, (match, offset: number) => {
        const start = Number(offset || 0);
        const end = start + match.length;
        if (shouldPreserveArtifact(seg, start, end)) return match;
        return "";
      })
      .replace(/[（(]\s*[，,、；;:：。.\-]*\s*[)）]/g, "")
    ),
  );
}

export const figureRefs = {
  id: "figure-refs",
  order: 1600,
  apply(text: string, _ctx: NormalizeContext): string {
    return normalizeFigureReferences(text);
  },
};

export const tableRefs = {
  id: "table-refs",
  order: 1700,
  apply(text: string, _ctx: NormalizeContext): string {
    return normalizeTableReferences(text);
  },
};

export const sectionArtifacts = {
  id: "section-artifacts",
  order: 1701,
  apply(text: string, _ctx: NormalizeContext): string {
    return stripSectionNumberArtifacts(text);
  },
};

registerRules(figureRefs, tableRefs, sectionArtifacts);
