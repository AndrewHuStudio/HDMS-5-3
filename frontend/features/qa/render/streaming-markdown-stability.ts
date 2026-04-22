export type PendingRenderMode = "markdown" | "plaintext" | "hidden";

export interface PreparedStreamingMarkdown {
  markdownForParser: string;
  pendingText: string;
  pendingRenderMode: PendingRenderMode;
  showPendingText: boolean;
}

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+\S/;
const LIST_MARKER_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/;
const LIST_MARKER_ONLY_RE = /^\s*(?:[-*+]|\d+[.)])\s*$/;
const FENCE_RE = /^\s*```/;
const INDENTED_CONTINUATION_RE = /^(?:\s{2,}|\t+)/;

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end -= 1;
  return lines.slice(0, end);
}

function joinLines(lines: string[]): string {
  return trimTrailingBlankLines(lines).join("\n").trimEnd();
}

function countInlineDollar(text: string): number {
  const cleanText = text.replace(/\$\$[\s\S]*?\$\$/g, "");
  const matches = cleanText.match(/(?<!\\)\$/g);
  return matches ? matches.length : 0;
}

function hasUnclosedFence(text: string): boolean {
  const count = String(text || "")
    .split("\n")
    .filter((line) => FENCE_RE.test(line)).length;
  return count % 2 === 1;
}

function hasUnclosedInlineMarkup(text: string): boolean {
  const lines = String(text || "").split("\n");
  const lastLine = lines[lines.length - 1] || "";
  const trimmed = lastLine.trimEnd();
  if (!trimmed) return false;

  const backticks = trimmed.match(/(?<!\\)`/g);
  if (backticks && backticks.length % 2 === 1) return true;

  const inlineDollars = countInlineDollar(trimmed);
  if (inlineDollars % 2 === 1) return true;

  if (/\[[^\]]*$/.test(trimmed)) return true;

  const strongMatches = trimmed.match(/\*\*/g);
  if (strongMatches && strongMatches.length % 2 === 1) return true;

  const cleanStrong = trimmed.replace(/\*\*/g, "");
  const starMatches = cleanStrong.match(/(?<!\\)\*/g);
  if (starMatches && starMatches.length % 2 === 1) return true;

  const cleanUnderscore = trimmed.replace(/__+/g, "");
  const underscoreMatches = cleanUnderscore.match(/(?<!\\)_/g);
  if (underscoreMatches && underscoreMatches.length % 2 === 1) return true;

  return false;
}

function isPureSyntaxFragment(text: string): boolean {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  if (/^\|[\s|:-]*\|?$/.test(trimmed)) return true;
  if (/^```[\w-]*$/.test(trimmed)) return true;
  if (LIST_MARKER_ONLY_RE.test(trimmed)) return true;
  return false;
}

function findLastUnclosedMathStart(text: string): number {
  let inBlock = false;
  let lastUnclosedInline = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "$" || text[i - 1] === "\\") continue;

    if (text[i + 1] === "$") {
      inBlock = !inBlock;
      i += 1;
      continue;
    }

    if (!inBlock) {
      lastUnclosedInline = lastUnclosedInline === -1 ? i : -1;
    }
  }

  if (inBlock) {
    const blockStart = text.lastIndexOf("$$");
    if (blockStart >= 0) return blockStart;
  }

  return lastUnclosedInline;
}

function splitLineAtUnclosedMath(line: string): { stablePart: string; tailPart: string } | null {
  const cleanLine = String(line || "");
  if (countInlineDollar(cleanLine) % 2 !== 1) return null;

  let start = -1;
  for (let i = 0; i < cleanLine.length; i += 1) {
    if (cleanLine[i] === "$" && cleanLine[i - 1] !== "\\" && cleanLine[i + 1] !== "$") {
      start = i;
    }
  }
  if (start < 0) return null;

  const stablePart = cleanLine.slice(0, start).trimEnd();
  const tailPart = cleanLine.slice(start).trimStart();
  if (!tailPart) return null;

  return { stablePart, tailPart };
}

function isIncompleteTableTail(text: string): boolean {
  const lines = String(text || "").split("\n").filter((line) => line.trim());
  if (lines.length === 0) return false;
  const tableLikeLines = lines.filter((line) => TABLE_ROW_RE.test(line) || TABLE_SEPARATOR_RE.test(line));
  if (tableLikeLines.length < 2) return false;

  const hasSeparator = tableLikeLines.some((line) => TABLE_SEPARATOR_RE.test(line));
  if (!hasSeparator) return true;

  const last = lines[lines.length - 1] || "";
  if (TABLE_SEPARATOR_RE.test(last)) return true;
  return /\|[^|]*$/.test(last) && !last.trim().endsWith("|");
}

function decidePendingRenderMode(text: string): PendingRenderMode {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "hidden";
  if (isPureSyntaxFragment(trimmed)) return "hidden";
  if (hasUnclosedFence(trimmed)) return "hidden";
  if (hasUnclosedInlineMarkup(trimmed)) return "plaintext";
  if (isIncompleteTableTail(trimmed)) return "plaintext";
  return "markdown";
}

function splitAtSafeBlockBoundary(markdown: string): { stable: string; tail: string } {
  const normalized = String(markdown || "").replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return { stable: "", tail: normalized };

  const lines = normalized.split("\n");
  const trimmedLines = trimTrailingBlankLines(lines);
  if (trimmedLines.length === 0) return { stable: "", tail: normalized };

  let lastSafeBoundary = 0;
  let i = 0;
  let inFence = false;

  while (i < trimmedLines.length) {
    const line = trimmedLines[i] || "";
    const trimmed = line.trim();

    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      if (!inFence) {
        lastSafeBoundary = i + 1;
      }
      i += 1;
      continue;
    }

    if (inFence) {
      i += 1;
      continue;
    }

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (TABLE_SEPARATOR_RE.test(line) || LIST_MARKER_ONLY_RE.test(line)) {
      i += 1;
      continue;
    }

    if (HEADING_RE.test(line)) {
      lastSafeBoundary = i + 1;
      i += 1;
      continue;
    }

    if (
      TABLE_ROW_RE.test(line) &&
      i + 1 < trimmedLines.length &&
      TABLE_SEPARATOR_RE.test(trimmedLines[i + 1] || "")
    ) {
      let tableEnd = i + 2;
      let sawIncompleteRow = false;
      while (tableEnd < trimmedLines.length) {
        const next = trimmedLines[tableEnd] || "";
        if (!next.trim()) break;
        if (TABLE_ROW_RE.test(next)) {
          tableEnd += 1;
          continue;
        }
        if (/^\s*\|/.test(next)) {
          sawIncompleteRow = true;
        }
        break;
      }
      if (!sawIncompleteRow) {
        lastSafeBoundary = tableEnd;
      }
      i = tableEnd;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      i += 1;
      continue;
    }

    if (LIST_MARKER_RE.test(line)) {
      let listEnd = i + 1;
      while (listEnd < trimmedLines.length) {
        const next = trimmedLines[listEnd] || "";
        if (!next.trim()) {
          const afterBlank = trimmedLines[listEnd + 1] || "";
          if (LIST_MARKER_RE.test(afterBlank) || INDENTED_CONTINUATION_RE.test(afterBlank)) {
            listEnd += 1;
            continue;
          }
          break;
        }
        if (LIST_MARKER_RE.test(next) || INDENTED_CONTINUATION_RE.test(next)) {
          listEnd += 1;
          continue;
        }
        break;
      }

      const listLines = trimmedLines.slice(i, listEnd);
      if (!hasUnclosedInlineMarkup(listLines.join("\n")) && !hasUnclosedFence(listLines.join("\n"))) {
        lastSafeBoundary = listEnd;
      }
      i = listEnd;
      continue;
    }

    let paragraphEnd = i + 1;
    while (paragraphEnd < trimmedLines.length && trimmedLines[paragraphEnd].trim()) {
      const next = trimmedLines[paragraphEnd] || "";
      if (HEADING_RE.test(next)) break;
      if (LIST_MARKER_RE.test(next)) break;
      if (
        TABLE_ROW_RE.test(next) &&
        paragraphEnd + 1 < trimmedLines.length &&
        TABLE_SEPARATOR_RE.test(trimmedLines[paragraphEnd + 1] || "")
      ) {
        break;
      }
      if (FENCE_RE.test(next)) break;
      paragraphEnd += 1;
    }

    const paragraph = trimmedLines.slice(i, paragraphEnd).join("\n");
    if (!hasUnclosedInlineMarkup(paragraph) && !hasUnclosedFence(paragraph)) {
      lastSafeBoundary = paragraphEnd;
    }
    i = paragraphEnd;
  }

  if (inFence) {
    for (let j = trimmedLines.length - 1; j >= 0; j -= 1) {
      if (FENCE_RE.test(trimmedLines[j] || "")) {
        lastSafeBoundary = Math.min(lastSafeBoundary, j);
        break;
      }
    }
  }

  let stable = joinLines(trimmedLines.slice(0, lastSafeBoundary));
  let tail = joinLines(trimmedLines.slice(lastSafeBoundary));

  if (stable && !tail) {
    const unclosedMathStart = findLastUnclosedMathStart(stable);
    if (unclosedMathStart >= 0) {
      const safeStable = stable.slice(0, unclosedMathStart).trimEnd();
      const mathTail = stable.slice(unclosedMathStart).trimStart();
      stable = safeStable;
      tail = mathTail;
    }
  } else if (stable) {
    const unclosedMathStart = findLastUnclosedMathStart(stable);
    if (unclosedMathStart >= 0) {
      const safeStable = stable.slice(0, unclosedMathStart).trimEnd();
      const mathTail = stable.slice(unclosedMathStart).trimStart();
      stable = safeStable;
      tail = joinLines([mathTail, tail].filter(Boolean));
    }
  }

  if (tail) {
    const tailLines = tail.split("\n");
    let firstContentIndex = 0;
    while (firstContentIndex < tailLines.length && !tailLines[firstContentIndex]?.trim()) {
      firstContentIndex += 1;
    }
    const firstTailLine = tailLines[firstContentIndex] || "";
    const splitMath = splitLineAtUnclosedMath(firstTailLine);
    if (splitMath && splitMath.stablePart) {
      const stablePrefix = stable ? `${stable}\n\n${splitMath.stablePart}` : splitMath.stablePart;
      stable = stablePrefix.trimEnd();
      const rebuiltTailLines = [
        ...tailLines.slice(0, firstContentIndex),
        splitMath.tailPart,
        ...tailLines.slice(firstContentIndex + 1),
      ].filter((line, index, arr) => {
        if (line) return true;
        return arr.slice(index + 1).some((next) => next);
      });
      tail = joinLines(rebuiltTailLines);
    }
  }

  return { stable, tail };
}

export function prepareStreamingMarkdown(markdown: string): PreparedStreamingMarkdown {
  const source = String(markdown || "");
  const { stable, tail } = splitAtSafeBlockBoundary(source);
  const pendingText = tail.replace(/^\n+/, "").trimEnd();
  const pendingRenderMode = decidePendingRenderMode(pendingText);

  return {
    markdownForParser: stable,
    pendingText,
    pendingRenderMode,
    showPendingText: pendingRenderMode !== "hidden",
  };
}
