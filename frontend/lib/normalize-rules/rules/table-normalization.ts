/**
 * 规则：loose-pipe-tables
 *
 * 将松散的管道分隔表格文本升级为有效的多行 GFM 表格块。
 * 处理全角管道符、连写行（||）、表格注释行等，流式模式保持保守策略。
 */

import {
  parseMarkdownBlocks,
} from "@/features/qa/formatting";
import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { bumpCounter } from "../utils";

const TABLE_BOUNDARY_NOTE_RE = /^(?:注|备注|说明|注释|提示|注意)\s*[：:]/;
const TABLE_TRAILING_META_RE = /^(?:数据来源|资料来源|来源|注|备注|说明|注释|提示|注意)\s*[：:]/;
// OCR/LLM outputs may use visual pipe variants (丨│┃¦...) instead of ASCII '|'.
const PIPE_VARIANT_RE = /[｜丨│┃¦￨￤]/g;

function stripInlineMdWrappers(value: string): string {
  let s = (value || "").trim();
  for (const wrapper of ["**", "__", "*", "_"]) {
    if (s.startsWith(wrapper) && s.endsWith(wrapper) && s.length > wrapper.length * 2) {
      s = s.slice(wrapper.length, -wrapper.length).trim();
    }
  }
  return s;
}

function escapeTableCell(value: string): string {
  return String(value || "").replace(/\|/g, "\\|").trim();
}

function normalizePipeDelimiters(line: string): string {
  return (line || "").replace(PIPE_VARIANT_RE, "|");
}

export const loosePipeTables = {
  id: "loose-pipe-tables",
  order: 900,
  apply(text: string, ctx: NormalizeContext): string {
    const streaming = ctx.phase === "streaming";
    if (!text) return text;
    if (streaming && !/[|｜]/.test(text)) return text;

    const parsePipeCells = (line: string): string[] | null => {
      const normalized = normalizePipeDelimiters(line);
      if (!normalized.includes("|")) return null;
      const trimmed = normalized.trim();
      if (!trimmed) return null;
      const cells = trimmed
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
      if (cells.length < 2) return null;
      if (!cells.some((cell) => cell.length > 0)) return null;
      return cells;
    };

    const isSeparatorRow = (cells: string[]): boolean =>
      cells.length > 0 && cells.every((cell) => !cell || /^:?-{3,}:?$/.test(cell));

    const padOrTrimRow = (cells: string[], cols: number): string[] => {
      const next = cells.slice(0, cols);
      while (next.length < cols) next.push("");
      return next;
    };

    const resolveColCount = (rows: string[][]): number => {
      const counts = new Map<number, number>();
      rows.forEach((row) => counts.set(row.length, (counts.get(row.length) || 0) + 1));
      let bestCols = rows[0]?.length || 3;
      let bestFreq = -1;
      counts.forEach((freq, cols) => {
        if (freq > bestFreq || (freq === bestFreq && cols > bestCols)) {
          bestCols = cols;
          bestFreq = freq;
        }
      });
      return Math.max(2, Math.min(8, bestCols));
    };

    const isBoundaryNoteRow = (cells: string[]): boolean => {
      const first = stripInlineMdWrappers(cells[0] || "").trim();
      if (!first || !TABLE_BOUNDARY_NOTE_RE.test(first)) return false;
      return cells.slice(1).every((cell) => !cell.trim());
    };

    const collapseNoteRow = (cells: string[]): string => {
      return cells
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
    };

    const isTrailingMetaLine = (value: string): boolean => {
      const text = stripInlineMdWrappers(value || "").trim();
      return Boolean(text) && TABLE_TRAILING_META_RE.test(text);
    };

    const rebuildCompressedSingleLineTable = (
      rawLine: string,
    ): { lines: string[]; changed: boolean; detachedNotes: number } | null => {
      const normalized = normalizePipeDelimiters(rawLine || "");
      if (!normalized.includes("|") || !normalized.includes("---")) return null;

      const rawCells = normalized
        .split("|")
        .map((cell) => stripInlineMdWrappers(cell).trim());

      const groupedRows: string[][] = [];
      let currentRow: string[] = [];
      let sawBoundary = false;

      for (const cell of rawCells) {
        if (!cell) {
          if (currentRow.length > 0) {
            groupedRows.push(currentRow);
            currentRow = [];
            sawBoundary = true;
          }
          continue;
        }
        currentRow.push(cell);
      }

      if (currentRow.length > 0) groupedRows.push(currentRow);
      if (!sawBoundary || groupedRows.length < 3) return null;

      const separatorIndex = groupedRows.findIndex((row) => isSeparatorRow(row));
      if (separatorIndex < 1) return null;

      const separatorCells = groupedRows[separatorIndex] || [];
      const colCount = separatorCells.length;
      if (colCount < 2) return null;

      const leadingLines = groupedRows
        .slice(0, Math.max(0, separatorIndex - 1))
        .map((row) => row.join(" | ").trim())
        .filter(Boolean);

      let headerCells = [...(groupedRows[separatorIndex - 1] || [])];
      if (headerCells.length === colCount + 1) {
        const leadCell = headerCells.shift()?.trim() || "";
        if (leadCell) leadingLines.push(leadCell);
      }

      if (headerCells.length !== colCount) return null;

      const bodyRows: string[][] = [];
      const trailingLines: string[] = [];

      for (const row of groupedRows.slice(separatorIndex + 1)) {
        if (row.length === colCount) {
          bodyRows.push(row);
          continue;
        }

        if (row.length === 1 && isTrailingMetaLine(row[0] || "")) {
          trailingLines.push(collapseNoteRow(row));
          continue;
        }

        if (row.length > colCount) {
          const rowHead = row.slice(0, colCount);
          const rowTail = row.slice(colCount).join(" ").replace(/[ \t]{2,}/g, " ").trim();
          if (rowHead.every((cell) => cell.trim().length > 0) && rowTail && isTrailingMetaLine(rowTail)) {
            bodyRows.push(rowHead);
            trailingLines.push(rowTail);
            continue;
          }
        }

        return null;
      }

      if (bodyRows.length === 0) return null;

      const indentMatch = (leadingLines[leadingLines.length - 1] || "").match(/^(\s{0,3})(?:[-*+]|\d+[.)])\s+/);
      const blockIndent = indentMatch ? `${indentMatch[1] || ""}   ` : "";
      const serializeRow = (cells: string[]): string =>
        `| ${cells.map((cell) => escapeTableCell(cell)).join(" | ")} |`;

      const out: string[] = [];
      if (leadingLines.length > 0) {
        out.push(...leadingLines);
        out.push("");
      }

      out.push(`${blockIndent}${serializeRow(headerCells)}`);
      out.push(`${blockIndent}| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`);
      bodyRows.forEach((row) => out.push(`${blockIndent}${serializeRow(row)}`));

      if (trailingLines.length > 0) {
        out.push("");
        trailingLines.forEach((line) => out.push(`${blockIndent}${line}`));
      }

      return {
        lines: out,
        changed: out.join("\n") !== rawLine,
        detachedNotes: trailingLines.length,
      };
    };

    const expandInlineRunOnRows = (lines: string[]): { lines: string[]; changed: boolean } => {
      const out: string[] = [];
      let changed = false;
      const separatorRowRe = /^:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+$/;

      for (const rawLine of lines) {
        const trimmed = normalizePipeDelimiters(rawLine || "").trim();
        if (!trimmed.includes("||")) { out.push(rawLine); continue; }
        const totalPipeCount = (trimmed.match(/\|/g) || []).length;
        if (totalPipeCount < 5) { out.push(rawLine); continue; }
        const parts = trimmed.split(/\|\|+/).map((part) => part.trim()).filter(Boolean);
        if (parts.length < 2) { out.push(rawLine); continue; }
        const rowLikeCount = parts.filter((part) => part.includes("|")).length;
        const hasSeparator = parts.some((part) =>
          separatorRowRe.test(part.replace(/^\|/, "").replace(/\|$/, "").trim()),
        );
        if (rowLikeCount < 2 || (!hasSeparator && parts.length < 3)) { out.push(rawLine); continue; }
        out.push(...parts);
        changed = true;
      }
      return { lines: out, changed };
    };

    const normalizeTableBlock = (
      lines: string[],
    ): { lines: string[]; changed: boolean; detachedNotes: number } => {
      if (lines.length === 1) {
        const rebuilt = rebuildCompressedSingleLineTable(lines[0] ?? "");
        if (rebuilt) return rebuilt;
      }

      const expanded = expandInlineRunOnRows(lines);
      const parsedRows = expanded.lines.map((line) => {
        const cells = parsePipeCells(line);
        if (!cells) return null;
        return { cells, separator: isSeparatorRow(cells) };
      });

      if (parsedRows.some((row) => row === null)) {
        return { lines, changed: false, detachedNotes: 0 };
      }

      const typedRows = parsedRows as Array<{ cells: string[]; separator: boolean }>;
      if (typedRows.length === 0) return { lines, changed: false, detachedNotes: 0 };
      if (typedRows.length === 1 && typedRows[0].cells.length < 4) {
        return { lines, changed: false, detachedNotes: 0 };
      }

      const nonSeparatorRows = typedRows.filter((row) => !row.separator).map((row) => row.cells);
      if (nonSeparatorRows.length < 2) {
        // Common LLM artifact: a single "row-like" pipe line with many cells
        // (e.g. "| 指标 | 约束A | 约束B | 图示 |"). Promote it into a compact
        // two-column table so markdown renderers can show it consistently.
        if (typedRows.length === 1 && !typedRows[0].separator) {
          const rowCells = typedRows[0].cells
            .map((cell) => stripInlineMdWrappers(cell).trim())
            .filter(Boolean);
          if (rowCells.length >= 3) {
            const key = escapeTableCell(rowCells[0]);
            const value = escapeTableCell(rowCells.slice(1).join("；"));
            return {
              lines: [
                "| 要素 | 内容 |",
                "| --- | --- |",
                `| ${key} | ${value} |`,
              ],
              changed: true,
              detachedNotes: 0,
            };
          }
        }
        return { lines, changed: false, detachedNotes: 0 };
      }

      const colCount = resolveColCount(nonSeparatorRows);
      const normalizedRows = typedRows.map((row) => padOrTrimRow(row.cells, colCount));
      const header = normalizedRows[0];
      let bodyStart = 1;
      if (typedRows.length > 1 && typedRows[1].separator) bodyStart = 2;

      const bodyRows = normalizedRows.slice(bodyStart);
      if (bodyRows.length === 0) return { lines, changed: false, detachedNotes: 0 };

      const noteLines: string[] = [];
      while (bodyRows.length > 0 && isBoundaryNoteRow(bodyRows[bodyRows.length - 1])) {
        const detached = collapseNoteRow(bodyRows.pop() || []);
        if (detached) noteLines.unshift(detached);
      }
      if (bodyRows.length === 0) return { lines, changed: false, detachedNotes: 0 };

      const out: string[] = [];
      out.push(`| ${header.join(" | ")} |`);
      out.push(`| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`);
      bodyRows.forEach((row) => out.push(`| ${row.join(" | ")} |`));
      if (noteLines.length > 0) out.push("", ...noteLines);

      const changed = expanded.changed || out.join("\n") !== lines.join("\n");
      return { lines: out, changed, detachedNotes: noteLines.length };
    };

    const blocks = parseMarkdownBlocks(text);
    let changed = false;
    let detachedNoteCount = 0;
    const normalizedChunks = blocks.map((block) => {
      if (block.type !== "table") return block.content;
      const normalized = normalizeTableBlock(block.lines);
      if (!normalized.changed) return block.content;
      changed = true;
      detachedNoteCount += normalized.detachedNotes;
      bumpCounter(ctx.diagnostics, "normalize-loose-pipe-table");
      return normalized.lines.join("\n");
    });

    if (detachedNoteCount > 0) {
      bumpCounter(ctx.diagnostics, "detached-table-note-lines", detachedNoteCount);
    }

    return changed ? normalizedChunks.join("\n") : text;
  },
};

export const listTableBlankLines = {
  id: "list-table-blank-lines",
  order: 901,
  apply(text: string, _ctx: NormalizeContext): string {
    if (!text || !text.includes("|")) return text;

    const lines = text.split("\n");
    const out: string[] = [];
    let changed = false;
    const listItemRe = /^\s{0,3}(?:[-*+]|\d+[.)])\s+\S/;
    const tableRowRe = /^\s*\|.+\|\s*$/;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const next = lines[i + 1] ?? "";
      out.push(line);

      if (!listItemRe.test(line)) continue;
      if (!next.trim()) continue;
      if (!tableRowRe.test(normalizePipeDelimiters(next).trim())) continue;

      out.push("");
      changed = true;
    }

    return changed ? out.join("\n") : text;
  },
};

registerRules(loosePipeTables, listTableBlankLines);
