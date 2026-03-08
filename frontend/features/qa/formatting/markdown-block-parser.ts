import { looksLikeHeadingPrefix } from "./heading-classifier";

export type MarkdownBlockType =
  | "code"
  | "math"
  | "table"
  | "heading_candidate"
  | "list"
  | "paragraph";

export interface MarkdownBlock {
  type: MarkdownBlockType;
  startLine: number;
  endLine: number;
  lines: string[];
  content: string;
}

const FENCED_CODE_START_RE = /^(\s*)(`{3,}|~{3,})/;
const MARKDOWN_HEADING_RE = /^\s*#{1,6}\s+\S/;
const BULLET_LIST_RE = /^\s{0,3}[-*+]\s+/;
const ORDERED_LIST_RE = /^\s{0,3}\d+[.)]\s+/;
const LIST_CONTINUATION_RE = /^\s{2,}\S/;
const TABLE_SEPARATOR_LINE_RE = /^[\s|:\-]+$/;
const TABLE_BOUNDARY_NOTE_RE = /^(?:注|备注|说明|注释|提示|注意)\s*[：:]/;
const FULLWIDTH_PIPE_RE = /｜/g;

function buildBlock(type: MarkdownBlockType, start: number, end: number, lines: string[]): MarkdownBlock {
  return {
    type,
    startLine: start,
    endLine: end,
    lines,
    content: lines.join("\n"),
  };
}

function parseCodeFenceMarker(line: string): string | null {
  const match = line.match(FENCED_CODE_START_RE);
  if (!match) return null;
  return match[2] ?? null;
}

function normalizePipeDelimiters(line: string): string {
  return (line || "").replace(FULLWIDTH_PIPE_RE, "|");
}

function looksLikeTableBoundaryNoteRow(trimmedLine: string): boolean {
  const normalized = normalizePipeDelimiters(trimmedLine || "").trim();
  if (!normalized.includes("|")) return false;

  const cells = normalized
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  if (cells.length < 2) return false;

  const firstCell = (cells[0] || "").replace(/^\*{1,2}|\*{1,2}$/g, "").trim();
  const hasTailContent = cells.slice(1).some((cell) => cell.trim().length > 0);
  return TABLE_BOUNDARY_NOTE_RE.test(firstCell) && !hasTailContent;
}

function isLikelyTableRow(line: string): boolean {
  const trimmed = normalizePipeDelimiters(line || "").trim();
  if (!trimmed || (!trimmed.includes("|") && !TABLE_SEPARATOR_LINE_RE.test(trimmed))) return false;
  if (looksLikeTableBoundaryNoteRow(trimmed)) return false;

  const pipeCount = (trimmed.match(/\|/g) || []).length;
  if (pipeCount < 2) return false;

  if (BULLET_LIST_RE.test(trimmed) || ORDERED_LIST_RE.test(trimmed)) {
    // Keep ordinary list lines out, but allow true table rows whose first cell
    // starts with "1." / "-" and still has multi-column structure.
    const cells = trimmed
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 3) return false;
  }

  if (TABLE_SEPARATOR_LINE_RE.test(trimmed)) {
    return /[:-]{3,}/.test(trimmed) || trimmed.includes("|");
  }

  if (/^\|.+\|$/.test(trimmed)) return true;

  const cells = trimmed
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
  return cells.length >= 3;
}

function isHeadingCandidate(line: string): boolean {
  const trimmed = (line || "").trim();
  if (!trimmed) return false;
  return MARKDOWN_HEADING_RE.test(trimmed) || looksLikeHeadingPrefix(trimmed);
}

function isListStart(line: string): boolean {
  return BULLET_LIST_RE.test(line) || ORDERED_LIST_RE.test(line);
}

function detectMathBlockStart(line: string): { delimiter: "$$" | "\\["; singleLine: boolean } | null {
  const trimmed = (line || "").trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("$$")) {
    if (trimmed === "$$") return { delimiter: "$$", singleLine: false };
    const matchCount = (trimmed.match(/\$\$/g) || []).length;
    return { delimiter: "$$", singleLine: matchCount >= 2 && trimmed.length > 4 };
  }

  if (trimmed.startsWith("\\[")) {
    const closingIndex = trimmed.indexOf("\\]");
    return { delimiter: "\\[", singleLine: closingIndex > 1 };
  }

  return null;
}

function isMathBlockEnd(line: string, delimiter: "$$" | "\\["): boolean {
  const trimmed = (line || "").trim();
  if (!trimmed) return false;
  if (delimiter === "$$") return trimmed.includes("$$");
  return trimmed.includes("\\]");
}

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  if (!text) return [];

  const lines = text.split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const current = lines[index] ?? "";
    const fenceMarker = parseCodeFenceMarker(current);
    if (fenceMarker) {
      const blockLines = [current];
      const startLine = index;
      index += 1;
      while (index < lines.length) {
        const line = lines[index] ?? "";
        blockLines.push(line);
        index += 1;
        if (line.trimStart().startsWith(fenceMarker)) break;
      }
      blocks.push(buildBlock("code", startLine, index - 1, blockLines));
      continue;
    }

    const mathStart = detectMathBlockStart(current);
    if (mathStart) {
      const blockLines = [current];
      const startLine = index;
      index += 1;

      if (!mathStart.singleLine) {
        while (index < lines.length) {
          const line = lines[index] ?? "";
          blockLines.push(line);
          index += 1;
          if (isMathBlockEnd(line, mathStart.delimiter)) break;
        }
      }

      blocks.push(buildBlock("math", startLine, index - 1, blockLines));
      continue;
    }

    if (isLikelyTableRow(current)) {
      const blockLines = [current];
      const startLine = index;
      index += 1;

      while (index < lines.length && isLikelyTableRow(lines[index] ?? "")) {
        blockLines.push(lines[index] ?? "");
        index += 1;
      }

      blocks.push(buildBlock("table", startLine, index - 1, blockLines));
      continue;
    }

    if (isHeadingCandidate(current)) {
      blocks.push(buildBlock("heading_candidate", index, index, [current]));
      index += 1;
      continue;
    }

    if (isListStart(current)) {
      const blockLines = [current];
      const startLine = index;
      index += 1;

      while (index < lines.length) {
        const nextLine = lines[index] ?? "";
        if (!nextLine.trim()) {
          // Blank line: peek ahead to see if the list continues after it.
          // If the next non-blank line is a list item or indented continuation,
          // absorb the blank line(s) and keep going; otherwise end the block.
          let peek = index + 1;
          while (peek < lines.length && !(lines[peek] ?? "").trim()) peek++;
          const afterBlank = lines[peek] ?? "";
          if (isLikelyTableRow(afterBlank)) {
            // End the list before a following table block. Keep one trailing
            // blank line attached to list for stable spacing.
            blockLines.push(nextLine);
            index += 1;
            break;
          }
          if (isListStart(afterBlank) || LIST_CONTINUATION_RE.test(afterBlank)) {
            // Absorb blank lines and continue the list block
            while (index < peek) {
              blockLines.push(lines[index] ?? "");
              index += 1;
            }
            continue;
          }
          // List ends here — absorb the trailing blank line and stop
          blockLines.push(nextLine);
          index += 1;
          break;
        }
        if (isLikelyTableRow(nextLine)) {
          // Do not swallow table-looking rows into a preceding list block.
          // Let the main parser handle them as independent table blocks.
          break;
        }
        if (isListStart(nextLine) || LIST_CONTINUATION_RE.test(nextLine)) {
          blockLines.push(nextLine);
          index += 1;
          continue;
        }
        break;
      }

      blocks.push(buildBlock("list", startLine, index - 1, blockLines));
      continue;
    }

    const paragraphLines = [current];
    const startLine = index;
    index += 1;

    while (index < lines.length) {
      const nextLine = lines[index] ?? "";
      if (
        parseCodeFenceMarker(nextLine) ||
        detectMathBlockStart(nextLine) ||
        isLikelyTableRow(nextLine) ||
        isHeadingCandidate(nextLine) ||
        isListStart(nextLine)
      ) {
        break;
      }

      paragraphLines.push(nextLine);
      index += 1;
      if (!nextLine.trim()) break;
    }

    blocks.push(buildBlock("paragraph", startLine, index - 1, paragraphLines));
  }

  return blocks;
}

export function serializeMarkdownBlocks(blocks: MarkdownBlock[]): string {
  if (!blocks.length) return "";
  return blocks.map((block) => block.content).join("\n");
}
