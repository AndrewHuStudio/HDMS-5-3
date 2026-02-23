/**
 * Normalize common LLM/OCR artifacts that break markdown rendering in our UI.
 *
 * This is the single source of truth for answer text normalization used by
 * qa-panel.tsx and qa-shell.tsx.
 */

import {
  classifyHeadingCandidate,
  parseMarkdownBlocks,
  serializeMarkdownBlocks,
  splitInlineHeadingAndBody,
} from "@/features/qa/formatting";

const INLINE_OR_FENCED_CODE_RE = /(```[\s\S]*?```|`[^`\n]*`)/g;

export interface NormalizeAnswerMarkdownArtifactsOptions {
  /**
   * Streaming mode should prefer stability and low-latency over aggressive
   * restructuring. We avoid heavy transforms on partial chunks.
   */
  streaming?: boolean;
  /**
   * Keep user-facing figure refs in place by default. Set to false only when
   * we explicitly want to rewrite inline figure refs.
   */
  preserveInlineFigureRefs?: boolean;
  /**
   * Emit normalization diagnostics in development for tuning classifier/table rules.
   */
  debugDiagnostics?: boolean;
}

/**
 * Regex that matches LaTeX delimiters ($...$, $$...$$) AND code blocks.
 * Used to split text so that destructive normalizations skip protected regions.
 */
const PROTECTED_REGION_RE =
  /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|```[\s\S]*?```|`[^`\n]*`|!\[[^\]\n]*\]\([^)\n]*\)|\[[^\]\n]+\]\([^)\n]*\))/g;

type NormalizationDiagnostics = {
  enabled: boolean;
  counters: Record<string, number>;
  heading: {
    heading: number;
    paragraph: number;
    reasons: Record<string, number>;
  };
};

function createDiagnostics(enabled: boolean): NormalizationDiagnostics {
  return {
    enabled,
    counters: {},
    heading: {
      heading: 0,
      paragraph: 0,
      reasons: {},
    },
  };
}

function bumpCounter(diag: NormalizationDiagnostics, key: string, by = 1): void {
  if (!diag.enabled) return;
  diag.counters[key] = (diag.counters[key] || 0) + by;
}

function bumpIfChanged(
  diag: NormalizationDiagnostics,
  key: string,
  before: string,
  after: string,
): void {
  if (!diag.enabled) return;
  if (before !== after) bumpCounter(diag, key);
}

function recordHeadingDecision(
  diag: NormalizationDiagnostics,
  decision: "heading" | "paragraph",
  reasons: string[],
): void {
  if (!diag.enabled) return;
  if (decision === "heading") diag.heading.heading += 1;
  else diag.heading.paragraph += 1;
  for (const reason of reasons) {
    diag.heading.reasons[reason] = (diag.heading.reasons[reason] || 0) + 1;
  }
}

function runBlockParserStage(text: string, diagnostics?: NormalizationDiagnostics): string {
  const blocks = parseMarkdownBlocks(text);
  if (diagnostics?.enabled) {
    bumpCounter(diagnostics, "block-total", blocks.length);
    for (const block of blocks) {
      bumpCounter(diagnostics, `block-${block.type}`);
    }
  }
  return serializeMarkdownBlocks(blocks);
}

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
 * Apply a transform function only to unprotected segments of text,
 * leaving LaTeX formulas and code blocks untouched.
 */
function transformUnprotected(text: string, fn: (segment: string) => string): string {
  const segments = text.split(PROTECTED_REGION_RE);
  return segments
    .map((segment, index) => (index % 2 === 1 ? segment : fn(segment)))
    .join("");
}

const RAG_IMAGE_ROUTE_RE = /^\/(?:api\/)?rag\/documents\/[^/?#]+\/image$/i;
const INLINE_MATH_IMAGE_WRAPPER_RE =
  /(?<!\\)\$\s*(!\[[^\]\n]*\]\([^)\n]+\)|<img\b[^>]*>)\s*\$(?!\$)/gi;
const DISPLAY_MATH_IMAGE_WRAPPER_RE =
  /(?<!\\)\$\$\s*(!\[[^\]\n]*\]\([^)\n]+\)|<img\b[^>]*>)\s*\$\$/gi;
const MARKDOWN_OR_HTML_IMAGE_RE = /(?:!\[[^\]\n]*\]\([^)\n]+\)|<img\b[^>]*>)/i;
const HTML_IMAGE_SRC_RE = /(<img\b[^>]*\bsrc=)(['"])([^'"]+)\2/gi;

function parseMarkdownImageDestination(raw: string): string {
  let cleaned = String(raw || "").trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("<") && cleaned.endsWith(">")) {
    cleaned = cleaned.slice(1, -1).trim();
  } else {
    const titleMatch = cleaned.match(/^(.*?)(?:\s+["'][^"']*["'])\s*$/);
    if (titleMatch?.[1]) cleaned = titleMatch[1].trim();
  }
  return cleaned.replace(/\\ /g, " ").replace(/\\\\/g, "\\").trim();
}

function isRenderableImageUrl(rawUrl: string): boolean {
  const url = String(rawUrl || "").trim();
  if (!url) return false;

  const normalized = normalizeRagImageQueryUrl(url);
  if (/^(?:https?:\/\/|data:)/i.test(normalized)) return true;
  if (!(normalized.startsWith("/rag/") || normalized.startsWith("/api/rag/"))) return false;

  try {
    const parsed = new URL(normalized, "http://localhost");
    if (!RAG_IMAGE_ROUTE_RE.test(parsed.pathname)) return true;
    return Boolean((parsed.searchParams.get("ref") || "").trim());
  } catch {
    return false;
  }
}

function normalizeRagImageQueryUrl(rawUrl: string): string {
  let url = String(rawUrl || "").trim();
  if (!url) return rawUrl;

  const wrappedInAngles = url.startsWith("<") && url.endsWith(">");
  if (wrappedInAngles) url = url.slice(1, -1).trim();

  const hashIndex = url.indexOf("#");
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = withoutHash.indexOf("?");
  if (queryIndex < 0) return rawUrl;

  const path = withoutHash.slice(0, queryIndex);
  const query = withoutHash.slice(queryIndex + 1);
  if (!RAG_IMAGE_ROUTE_RE.test(path) || !query) return rawUrl;

  let changed = false;
  const normalizedQuery = query
    .split("&")
    .map((part) => {
      if (!part) return part;
      const eqIndex = part.indexOf("=");
      const rawKey = eqIndex >= 0 ? part.slice(0, eqIndex) : part;
      let value = eqIndex >= 0 ? part.slice(eqIndex + 1) : "";
      let key = rawKey;

      if (key === "$ref") {
        key = "ref";
        changed = true;
      }

      if (key === "ref") {
        const cleanedValue = value.replace(/\$/g, "");
        if (cleanedValue !== value) {
          value = cleanedValue;
          changed = true;
        }
      }

      if (eqIndex < 0) return key;
      return `${key}=${value}`;
    })
    .join("&");

  if (!changed) return rawUrl;

  const rebuilt = `${path}?${normalizedQuery}${hash}`;
  return wrappedInAngles ? `<${rebuilt}>` : rebuilt;
}

function normalizeBrokenRagImageRefs(text: string): string {
  if (!text) return text;

  const normalizeUrl = (value: string): string => normalizeRagImageQueryUrl(value);

  let out = text.replace(
    /!\[([^\]\n]*)\]\(([^)\n]+)\)/g,
    (_match, alt: string, rawUrl: string) => `![${alt}](${normalizeUrl(rawUrl)})`,
  );

  out = out.replace(
    /(<img\b[^>]*\bsrc=)(['"])([^'"]+)\2/gi,
    (_match, prefix: string, quote: string, rawUrl: string) =>
      `${prefix}${quote}${normalizeUrl(rawUrl)}${quote}`,
  );

  // Safety-net for plain-text URLs that were previously corrupted by backend
  // math post-processing and escaped markdown rendering.
  out = out.replace(
    /\/(?:api\/)?rag\/documents\/[^/?#\s)]+\/image\?[^\s)]+/g,
    (rawUrl) => normalizeUrl(rawUrl),
  );

  return out;
}

function unwrapMathWrappedImages(text: string): string {
  if (!text) return text;

  const segments = text.split(INLINE_OR_FENCED_CODE_RE);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment
        .replace(DISPLAY_MATH_IMAGE_WRAPPER_RE, "$1")
        .replace(INLINE_MATH_IMAGE_WRAPPER_RE, "$1");
    })
    .join("");
}

function stripUnrenderableImageTokens(text: string, diagnostics?: NormalizationDiagnostics): string {
  if (!text) return text;

  const segments = text.split(INLINE_OR_FENCED_CODE_RE);
  let removedCount = 0;
  const out = segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment;

      let next = segment.replace(
        /!\[([^\]\n]*)\]\(([^)\n]+)\)/g,
        (_match, alt: string, rawUrl: string) => {
          const url = parseMarkdownImageDestination(rawUrl);
          if (isRenderableImageUrl(url)) {
            return `![${alt}](${normalizeRagImageQueryUrl(url)})`;
          }
          removedCount += 1;
          return "";
        },
      );

      next = next.replace(HTML_IMAGE_SRC_RE, (_match, prefix: string, quote: string, rawUrl: string) => {
        const url = String(rawUrl || "").trim();
        if (!isRenderableImageUrl(url)) {
          removedCount += 1;
          return "";
        }
        return `${prefix}${quote}${normalizeRagImageQueryUrl(url)}${quote}`;
      });

      return next;
    })
    .join("");

  if (removedCount > 0 && diagnostics?.enabled) {
    bumpCounter(diagnostics, "strip-unrenderable-image-tokens", removedCount);
  }

  return out;
}

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

/**
 * Keep "相关概念" answer body in paragraph style.
 * Demote ALL heading lines inside the section to plain text so the UI
 * renders them as normal body font instead of blue section titles.
 * Exit when hitting a known major section boundary (## 详细解析, ## 结论, etc.).
 *
 * This is idempotent: if the backend already demoted headings, the lines
 * won't match as headings here and pass through unchanged.
 */
function normalizeRelatedConceptsBody(text: string): string {
  const lines = text.split("\n");
  let inRelated = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx] ?? "";
    const trimmed = raw.trim();
    const heading = extractMarkdownHeadingLoose(trimmed);
    const headingTitle = heading ? normalizeHeadingTitle(heading.title) : "";

    if (heading && heading.level === 2 && headingTitle.startsWith("相关概念")) {
      inRelated = true;
      continue;
    }

    if (!inRelated || !trimmed) continue;

    // Exit on major section boundary.
    if (heading && heading.level === 2 && MAJOR_SECTION_TITLE_RE.test(headingTitle)) {
      inRelated = false;
      continue;
    }

    // Demote any heading inside the section to plain text.
    if (heading) {
      lines[idx] = headingTitle;
      continue;
    }

    // Strip leading blockquote markers from body text.
    lines[idx] = stripQuotePrefix(raw);
  }

  return lines.join("\n");
}

function normalizeStarRunPlaceholders(text: string): string {
  return transformUnprotected(text, (seg) => {
    const lines = seg.split("\n");
    return lines
      .map((line) => {
        // Keep markdown horizontal rules like "***" / "****" intact.
        if (/^\s*\*{3,}\s*$/.test(line)) return line;
        return line.replace(/\*{4,}/g, "相关资料");
      })
      .join("\n");
  });
}

function splitRunOnNumberedItems(text: string): string {
  return transformUnprotected(text, (seg) => {
    const lines = seg.split("\n");

    return lines
      .map((line) => {
        // Keep table content intact, but still normalize leading list marker spacing.
        if (line.includes("|")) {
          return line.replace(/^([ \t]*\d{1,2}[.．])(?=[^\s\d])/, "$1 ");
        }

        // Ensure "1.文本" -> "1. 文本" at line start.
        let normalized = line.replace(/^([ \t]*\d{1,2}[.．])(?=[^\s\d])/, "$1 ");
        const markerRe = /\d{1,2}[.．](?=\s*[^\s\d])/g;
        const matches = Array.from(normalized.matchAll(markerRe)).filter((m) => {
          const pos = m.index ?? 0;
          const marker = m[0] || "";
          const prevChar = pos > 0 ? normalized[pos - 1] : "";
          const tail = normalized.slice(pos + marker.length).trimStart();

          // Guard against splitting inside filenames/hash tokens like:
          // "307b272.jpg" -> "307b2\\n72. jpg" (wrong).
          if (prevChar && /[A-Za-z0-9_./-]/.test(prevChar)) return false;
          if (/^(?:jpe?g|png|webp|gif|bmp|svg)\b/i.test(tail)) return false;

          return true;
        });
        if (matches.length <= 1) return normalized;

        let out = "";
        let last = 0;

        matches.forEach((m, idx) => {
          const pos = m.index ?? 0;
          const marker = m[0];

          out += normalized.slice(last, pos);
          if (idx > 0 && !out.endsWith("\n")) out += "\n";
          out += marker;
          if ((normalized[pos + marker.length] ?? "").trim()) out += " ";
          last = pos + marker.length;
        });

        out += normalized.slice(last);
        return out;
      })
      .join("\n");
  });
}

function splitHeadingAndInlineNumberedSubitem(text: string, diagnostics?: NormalizationDiagnostics): string {
  return transformUnprotected(text, (seg) => {
    const lines = seg.split("\n");
    return lines
      .map((line) => {
        const nextLine = splitInlineHeadingAndBody(line);
        if (diagnostics && nextLine !== line) bumpCounter(diagnostics, "split-inline-heading-body");
        return nextLine;
      })
      .join("\n");
  });
}

const TABLE_BOUNDARY_NOTE_RE = /^(?:注|备注|说明|注释|提示|注意)\s*[：:]/;

interface NormalizeLoosePipeTableOptions {
  diagnostics?: NormalizationDiagnostics;
  streaming?: boolean;
}

function normalizeLoosePipeTables(
  text: string,
  options: NormalizeLoosePipeTableOptions = {},
): string {
  const { diagnostics, streaming = false } = options;
  if (!text) return text;
  if (streaming && !/[|｜]/.test(text)) return text;

  const parsePipeCells = (line: string): string[] | null => {
    if (!line.includes("|")) return null;
    const trimmed = line.trim();
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

  const expandInlineRunOnRows = (lines: string[]): { lines: string[]; changed: boolean } => {
    const out: string[] = [];
    let changed = false;

    const separatorRowRe = /^:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+$/;

    for (const rawLine of lines) {
      const trimmed = (rawLine || "").trim();
      if (!trimmed.includes("||")) {
        out.push(rawLine);
        continue;
      }

      const totalPipeCount = (trimmed.match(/\|/g) || []).length;
      if (totalPipeCount < 5) {
        out.push(rawLine);
        continue;
      }

      const parts = trimmed
        .split(/\|\|+/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length < 2) {
        out.push(rawLine);
        continue;
      }

      const rowLikeCount = parts.filter((part) => part.includes("|")).length;
      const hasSeparator = parts.some((part) =>
        separatorRowRe.test(
          part
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .trim(),
        ),
      );
      if (rowLikeCount < 2 || (!hasSeparator && parts.length < 3)) {
        out.push(rawLine);
        continue;
      }

      out.push(...parts);
      changed = true;
    }

    return { lines: out, changed };
  };

  const normalizeTableBlock = (
    lines: string[],
  ): { lines: string[]; changed: boolean; detachedNotes: number } => {
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
      // Avoid converting incidental single-line prose with pipes.
      return { lines, changed: false, detachedNotes: 0 };
    }

    const nonSeparatorRows = typedRows.filter((row) => !row.separator).map((row) => row.cells);
    if (nonSeparatorRows.length < 2) return { lines, changed: false, detachedNotes: 0 };

    const colCount = resolveColCount(nonSeparatorRows);
    const normalizedRows = typedRows.map((row) => padOrTrimRow(row.cells, colCount));
    const header = normalizedRows[0];
    let bodyStart = 1;
    if (typedRows.length > 1 && typedRows[1].separator) {
      bodyStart = 2;
    }

    const bodyRows = normalizedRows.slice(bodyStart);
    if (bodyRows.length === 0) return { lines, changed: false, detachedNotes: 0 };

    const noteLines: string[] = [];
    while (bodyRows.length > 0 && isBoundaryNoteRow(bodyRows[bodyRows.length - 1])) {
      const detached = collapseNoteRow(bodyRows.pop() || []);
      if (detached) noteLines.unshift(detached);
    }

    if (bodyRows.length === 0) {
      return { lines, changed: false, detachedNotes: 0 };
    }

    const out: string[] = [];
    out.push(`| ${header.join(" | ")} |`);
    out.push(`| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`);
    bodyRows.forEach((row) => out.push(`| ${row.join(" | ")} |`));

    if (noteLines.length > 0) {
      out.push("", ...noteLines);
    }

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
    if (diagnostics) bumpCounter(diagnostics, "normalize-loose-pipe-table");
    return normalized.lines.join("\n");
  });

  if (diagnostics && detachedNoteCount > 0) {
    bumpCounter(diagnostics, "detached-table-note-lines", detachedNoteCount);
  }

  return changed ? normalizedChunks.join("\n") : text;
}

const HEADING_LINE_RE = /^(#{1,6})\s*(.*?)\s*$/;

function normalizeMarkdownHeadingHierarchy(text: string, diagnostics?: NormalizationDiagnostics): string {
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
      // Trust explicit markdown headings and only normalize their level/title.
      let level = originalLevel;
      if (MAJOR_SECTION_TITLE_RE.test(semanticTitle)) level = 2;
      level = Math.max(2, Math.min(6, level));
      if (diagnostics) {
        recordHeadingDecision(diagnostics, "heading", ["explicit-markdown-heading"]);
      }
      return `${"#".repeat(level)} ${semanticTitle}`;
    }

    const classification = classifyHeadingCandidate(semanticTitle, {
      previousNonEmptyLine: findPreviousNonEmptyLine(idx),
      nextNonEmptyLine: findNextNonEmptyLine(idx),
      lineIndex: idx,
      totalLines: lines.length,
    });
    if (diagnostics) {
      recordHeadingDecision(diagnostics, classification.decision, classification.reasons);
    }

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
}

function hasBalancedBraces(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function sanitizeBrokenLatexFragment(fragment: string): string {
  let out = fragment;

  // Unwrap common text wrappers first.
  out = out.replace(/\\text\{([^{}]*)\}/g, "$1");
  out = out.replace(/\\text\(([^()]*)\)/g, "$1");
  // Best-effort for unclosed \text{... at line end.
  out = out.replace(/\\text\{([^{}\n]+)(?=\n|$)/g, "$1");

  // Convert simple fractions to readable plain-text ratios.
  out = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2");

  // Convert common math operators to unicode symbols.
  out = out
    .replace(/\\geq/g, "≥")
    .replace(/\\leq/g, "≤")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·");

  // Remove remaining latex command names and dangling braces.
  out = out.replace(/\\[A-Za-z]+/g, "");
  out = out.replace(/[{}]/g, "");

  // OCR often emits em/en dashes in standard IDs and denominator tails.
  out = out.replace(/[−—]/g, "-");
  out = out.replace(/\s*---+\s*/g, " ");

  // Collapse line noise and tighten common punctuation spacing.
  out = out
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*([：:])\s*/g, "$1")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  // Reconstruct common standard identifier split as "G B / T 51328 - 2018".
  out = out
    .replace(/\bG\s*B\s*\/\s*T\s*(\d{4,6})\s*-\s*(\d{4})\b/gi, "GB/T$1-$2")
    .replace(/\bG\s*B\s*\/\s*T\b/gi, "GB/T");

  return out;
}

const CODE_OR_DOLLAR_MATH_RE = /(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;
const FORMULA_LATEX_TOKEN_RE =
  /\\(?:frac|sum|sqrt|times|cdot|geq|leq|approx|neq|text|max|min|int|prod|left|right|operatorname)\b/i;
const FORMULA_SENTENCE_PUNCT_RE = /[。！？；]/;
const FORMULA_OPERATOR_RE = /(?:=|>=|<=|>|<|≥|≤|\\geq|\\leq|\\approx|\\neq|[+\-*/×÷^])/;

function transformOutsideCodeAndDollarMath(text: string, fn: (segment: string) => string): string {
  const segments = text.split(CODE_OR_DOLLAR_MATH_RE);
  return segments
    .map((segment, index) => (index % 2 === 1 ? segment : fn(segment)))
    .join("");
}

/**
 * Frontend fallback for math delimiters:
 * - \[...\] -> $$...$$
 * - \(...\) -> $...$
 * - \$...\$ / \$\$...\$\$ -> $...$ / $$...$$
 */
function normalizeMathDelimitersForRenderer(text: string): string {
  if (!text) return text;

  return transformOutsideCodeAndDollarMath(text, (segment) => {
    let out = segment;

    // Normalize double-escaped bracket delimiters first.
    out = out
      .replace(/\\\\\[/g, "\\[")
      .replace(/\\\\\]/g, "\\]")
      .replace(/\\\\\(/g, "\\(")
      .replace(/\\\\\)/g, "\\)");

    out = out.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_m, inner: string) => `$$\n${inner.trim()}\n$$`);
    out = out.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_m, inner: string) => `$${inner.trim()}$`);

    // Unescape dollar delimiters emitted by some model outputs.
    out = out.replace(/\\\$\$([\s\S]*?)\\\$\$/g, (_m, inner: string) => `$$${inner}$$`);
    out = out.replace(/\\\$([\s\S]+?)\\\$/g, (_m, inner: string) => `$${inner}$`);

    return out;
  });
}

function looksLikeBareFormulaExpression(value: string): boolean {
  const text = (value || "").trim();
  if (!text) return false;
  if (MARKDOWN_OR_HTML_IMAGE_RE.test(text)) return false;
  if (text.length < 6 || text.length > 220) return false;
  if (text.includes("|")) return false;
  if (FORMULA_SENTENCE_PUNCT_RE.test(text)) return false;
  if (/^\d+[.)]\s+/.test(text) || /^[-*+]\s+/.test(text) || /^#{1,6}\s+/.test(text)) return false;
  if (/\[\d{1,2}-\d{1,2}\]/.test(text)) return false;

  const hasLatex = FORMULA_LATEX_TOKEN_RE.test(text);
  const hasOperator = FORMULA_OPERATOR_RE.test(text);
  if (hasLatex && hasOperator) return true;

  // Fallback for non-LaTeX formula text like "A = B/C × 100%".
  const hasEquation = /[A-Za-z\u4e00-\u9fff]\s*=\s*[^\s]/.test(text);
  const hasArithmetic = /[+\-*/×÷]/.test(text);
  return hasEquation && hasArithmetic;
}

function promoteBareFormulaParagraphs(text: string, diagnostics?: NormalizationDiagnostics): string {
  if (!text) return text;

  const blocks = parseMarkdownBlocks(text);
  let changed = false;

  const mapped = blocks.map((block) => {
    if (block.type !== "paragraph") return block.content;

    const lines = block.lines;
    const next: string[] = [];
    let blockChanged = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        next.push(line);
        continue;
      }

      if (/^\$\$/.test(trimmed) || /^\$[^$]+?\$$/.test(trimmed)) {
        next.push(line);
        continue;
      }

      const inlineSplit = trimmed.match(/^(.{1,28}[：:])\s*(.+)$/);
      if (inlineSplit && looksLikeBareFormulaExpression(inlineSplit[2])) {
        next.push(inlineSplit[1], "", "$$", inlineSplit[2].trim(), "$$");
        blockChanged = true;
        continue;
      }

      if (looksLikeBareFormulaExpression(trimmed)) {
        next.push("$$", trimmed, "$$");
        blockChanged = true;
        continue;
      }

      next.push(line);
    }

    if (blockChanged) {
      changed = true;
      if (diagnostics) bumpCounter(diagnostics, "promote-bare-formula-paragraph");
      return next.join("\n");
    }

    return block.content;
  });

  return changed ? mapped.join("\n") : text;
}

/**
 * Light-touch fix for broken inline math delimiters.
 *
 * Philosophy: the model's output is trusted by default.  We only intervene
 * when a `$...$` span is *clearly* broken (unbalanced braces, contains
 * markdown heading markers, or spans multiple lines).  In all other cases
 * the original text passes through unchanged so the model's formatting
 * intent is preserved.
 */
function normalizeBrokenInlineMath(text: string): string {
  let out = "";
  let idx = 0;

  while (idx < text.length) {
    const ch = text[idx];

    // Keep $$...$$ blocks untouched.
    if (ch === "$" && text[idx + 1] === "$") {
      // Find closing $$
      const closeIdx = text.indexOf("$$", idx + 2);
      if (closeIdx >= 0) {
        out += text.slice(idx, closeIdx + 2);
        idx = closeIdx + 2;
      } else {
        out += "$$";
        idx += 2;
      }
      continue;
    }

    if (ch !== "$") {
      out += ch;
      idx += 1;
      continue;
    }

    // Ignore escaped dollars.
    if (idx > 0 && text[idx - 1] === "\\") {
      out += ch;
      idx += 1;
      continue;
    }

    // Find the next unescaped single '$'.
    let end = idx + 1;
    let found = -1;
    while (end < text.length) {
      if (text[end] === "$" && text[end + 1] !== "$" && text[end - 1] !== "\\") {
        found = end;
        break;
      }
      end += 1;
    }

    if (found < 0) {
      // Unmatched single '$' — keep it as-is rather than silently dropping.
      // The markdown renderer / KaTeX will handle it gracefully.
      out += ch;
      idx += 1;
      continue;
    }

    const inner = text.slice(idx + 1, found);

    // Only sanitize when the span is *clearly* broken:
    // - contains heading markers (### glued into math)
    // - spans multiple lines AND has unbalanced braces
    const hasBrokenHeading = /#{2,}/.test(inner);
    const multilineAndUnbalanced = inner.includes("\n") && !hasBalancedBraces(inner);

    if (hasBrokenHeading || multilineAndUnbalanced) {
      out += sanitizeBrokenLatexFragment(inner);
    } else {
      // Trust the model — keep the math span intact.
      out += `$${inner}$`;
    }

    idx = found + 1;
  }

  // Split heading markers accidentally glued after broken inline math output.
  out = out.replace(/([^\n#])\s*(#{2,6}\s*[一二三四五六七八九十0-9]+[、.．])/g, "$1\n$2");
  // Remove standalone orphan heading markers like "###".
  out = out.replace(/^[ \t]*#{2,6}[ \t]*$/gm, "");

  // Final cleanup for accidental empty lines after orphan marker removal.
  out = out.replace(/\n{3,}/g, "\n\n");

  return out;
}
const RANGE_VALUE_RE = String.raw`(?:[<>]=?|[≥≤])?\s*\d+(?:\.\d+)*(?:[%％])?`;
const BROKEN_NUMERIC_RANGE_RE = new RegExp(
  `(${RANGE_VALUE_RE})\\s*~~\\s*(${RANGE_VALUE_RE})(?:\\s*~~)?`,
  "g"
);

const normalizeNumericRangeDelimiters = (text: string): string => {
  return transformUnprotected(text, (seg) =>
    seg.replace(BROKEN_NUMERIC_RANGE_RE, "$1~$2")
  );
};

// ---------------------------------------------------------------------------
// 1. Chinese heading → Markdown heading conversion
// ---------------------------------------------------------------------------

// Level-1: "一、标题" or "**一、标题**" (standalone line)
const CN_H1_RE = /^(?:\*{2})?\s*([一二三四五六七八九十]+)[、.．]\s*(.+?)(?:\*{2})?\s*$/;
// Level-2: "（一）标题" or "(一) 标题" or "**（一）标题**"
const CN_H2_RE = /^(?:\*{2})?\s*[（(]\s*([一二三四五六七八九十]+)\s*[)）]\s*(.+?)(?:\*{2})?\s*$/;
// Level-2 alt: "1. 标题" / "1、标题" at top-level that looks like a section heading
// (only when it doesn't look like part of an ordered list)
const NUM_H2_RE = /^\s*(\d{1,2})[.、．]\s*(.+?)\s*$/;
// Level-3: "1) 标题" or "①标题"
const CN_H3_RE = /^(?:\*{2})?\s*(\d+)[)）]\s*(.+?)(?:\*{2})?\s*$/;
const CIRCLED_H3_RE = /^(?:\*{2})?\s*([\u2460-\u2469])\s*(.+?)(?:\*{2})?\s*$/;
// Decimal section heading variants: ".0.3标题" / "0.3 标题" / "2.1.4 标题"
const DECIMAL_SECTION_RE =
  /^(?:\*{2})?\s*[.。]?\s*(\d{1,2}(?:\.\d{1,2}){1,3})\s*(.+?)(?:\*{2})?\s*$/;

/**
 * Convert Chinese-style headings to Markdown headings.
 * Processes line-by-line; only converts lines that look like standalone headings.
 */
function normalizeChineseHeadings(text: string, diagnostics?: NormalizationDiagnostics): string {
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

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    const trimmed = line.trim();

    // Skip empty lines and lines already in markdown heading format
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
      const candidate = `${match[1]}、${match[2].trim()}`;
      const classification = classifyHeadingCandidate(candidate, {
        previousNonEmptyLine: prevNonEmptyLine(idx) || "",
        nextNonEmptyLine: nextNonEmptyLine(idx) || "",
        lineIndex: idx,
        totalLines: lines.length,
      });
      if (diagnostics) {
        recordHeadingDecision(diagnostics, classification.decision, classification.reasons);
      }
      if (classification.decision !== "heading") {
        result.push(line);
        continue;
      }
      // Preserve numbering for better reading guidance (e.g., "一、...").
      result.push(`## ${match[1]}、${match[2].trim()}`);
      continue;
    }

    // Level-2: （一）标题
    match = trimmed.match(CN_H2_RE);
    if (match) {
      const candidate = `（${match[1]}）${match[2].trim()}`;
      const classification = classifyHeadingCandidate(candidate, {
        previousNonEmptyLine: prevNonEmptyLine(idx) || "",
        nextNonEmptyLine: nextNonEmptyLine(idx) || "",
        lineIndex: idx,
        totalLines: lines.length,
      });
      if (diagnostics) {
        recordHeadingDecision(diagnostics, classification.decision, classification.reasons);
      }
      if (classification.decision !== "heading") {
        result.push(line);
        continue;
      }
      result.push(`### （${match[1]}）${match[2].trim()}`);
      continue;
    }

    // Level-2 alt: "1. 标题" / "1、标题" used as a section header (not a list item).
    match = trimmed.match(NUM_H2_RE);
    if (match) {
      const title = match[2].trim();
      const classification = classifyHeadingCandidate(`${match[1]}. ${title}`, {
        previousNonEmptyLine: prevNonEmptyLine(idx) || "",
        nextNonEmptyLine: nextNonEmptyLine(idx) || "",
        lineIndex: idx,
        totalLines: lines.length,
      });
      if (diagnostics) {
        recordHeadingDecision(diagnostics, classification.decision, classification.reasons);
      }

      if (classification.decision === "heading") {
        result.push(`### ${match[1]}. ${title}`);
        continue;
      }
    }

    // Level-3: 1) 标题 or ① 标题
    match = trimmed.match(CN_H3_RE);
    if (match) {
      const candidate = `${match[1]}) ${match[2].trim()}`;
      const classification = classifyHeadingCandidate(candidate, {
        previousNonEmptyLine: prevNonEmptyLine(idx) || "",
        nextNonEmptyLine: nextNonEmptyLine(idx) || "",
        lineIndex: idx,
        totalLines: lines.length,
      });
      if (diagnostics) {
        recordHeadingDecision(diagnostics, classification.decision, classification.reasons);
      }
      if (classification.decision !== "heading") {
        result.push(line);
        continue;
      }
      result.push(`#### ${match[1]}) ${match[2].trim()}`);
      continue;
    }

    match = trimmed.match(CIRCLED_H3_RE);
    if (match) {
      const candidate = `${match[1]} ${match[2].trim()}`;
      const classification = classifyHeadingCandidate(candidate, {
        previousNonEmptyLine: prevNonEmptyLine(idx) || "",
        nextNonEmptyLine: nextNonEmptyLine(idx) || "",
        lineIndex: idx,
        totalLines: lines.length,
      });
      if (diagnostics) {
        recordHeadingDecision(diagnostics, classification.decision, classification.reasons);
      }
      if (classification.decision !== "heading") {
        result.push(line);
        continue;
      }
      result.push(`#### ${match[1]} ${match[2].trim()}`);
      continue;
    }

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
        if (diagnostics) {
          recordHeadingDecision(diagnostics, classification.decision, classification.reasons);
        }
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
}

// ---------------------------------------------------------------------------
// 2. Ordered list numbering fix
// ---------------------------------------------------------------------------

/**
 * Fix ordered list numbering so that items under the same heading are
 * sequentially numbered (1. 2. 3.) instead of all being "1.".
 */
export function normalizeMarkdownLists(content: string): string {
  if (!content) return content;

  const normalizeListBlockContent = (blockContent: string): string => {
    const lines = blockContent.split(/\r?\n/);
    let activeIndent = "";
    let orderedCounter = 0;
    const isOrderedListInterludeLine = (trimmed: string): boolean => {
      const pipeCount = (trimmed.match(/\|/g) || []).length;
      return (
        /^[:：]\s*/.test(trimmed) ||
        /^!\[[^\]]*]\([^)]*\)/.test(trimmed) ||
        /^<img\b/i.test(trimmed) ||
        /^FIGCAPTION\b/i.test(trimmed) ||
        /^(?:相关示意图|示意图|附图|见图|图\d+)/.test(trimmed) ||
        /^\|.*\|$/.test(trimmed) ||
        pipeCount >= 2 ||
        /^>\s*/.test(trimmed)
      );
    };

    return lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Reset counter on section breaks (headings, horizontal rules, bold-only lines)
        const sectionBreak =
          /^#{1,6}\s+/.test(trimmed) ||
          /^[-*_]{3,}$/.test(trimmed) ||
          /^\*\*.+\*\*$/.test(trimmed);
        if (sectionBreak) {
          orderedCounter = 0;
          activeIndent = "";
        }

        // Match ordered list items: "  1. text"
        const orderedMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
        if (orderedMatch) {
          const indent = orderedMatch[1] ?? "";
          const body = orderedMatch[2] ?? "";
          const originalNum = parseInt(line.match(/^\s*(\d+)\./)?.[1] ?? "1", 10);

          if (indent === activeIndent && orderedCounter > 0) {
            orderedCounter += 1;
          } else {
            orderedCounter = 1;
            activeIndent = indent;
          }

          // Preserve original numbering when it diverges significantly from
          // sequential order — likely a clause/section reference (e.g. "3.", "4.")
          // rather than a misnumbered list.
          if (originalNum > 1 && Math.abs(originalNum - orderedCounter) > 2) {
            orderedCounter = originalNum;
            return line;
          }

          return `${indent}${orderedCounter}. ${body}`;
        }

        // Nested bullet under an ordered list
        const bulletMatch = line.match(/^(\s*)[-*+]\s+/);
        if (bulletMatch) {
          const bulletIndent = bulletMatch[1] ?? "";
          if (orderedCounter > 0 && bulletIndent.length <= activeIndent.length) {
            const normalized = line.trimStart();
            return `${activeIndent}  ${normalized}`;
          }
          return line;
        }

        // Non-list, non-blank line at root level resets counter
        if (orderedCounter > 0 && isOrderedListInterludeLine(trimmed)) {
          return line;
        }

        // Non-list, non-blank line at root level resets counter
        if (/^\S/.test(line)) {
          orderedCounter = 0;
          activeIndent = "";
        }

        return line;
      })
      .join("\n");
  };

  const blocks = parseMarkdownBlocks(content);
  let changed = false;
  const out = blocks.map((block) => {
    if (block.type !== "list") return block.content;
    const normalized = normalizeListBlockContent(block.content);
    if (normalized !== block.content) changed = true;
    return normalized;
  });

  return changed ? out.join("\n") : content;
}

// ---------------------------------------------------------------------------
// 3. Figure reference normalization
// ---------------------------------------------------------------------------

// Matches inline figure references like "见图3.0.3", "（见图3.0.1）", "如图2所示",
// and plain "（图3.2.1）" artifacts.
const FIGURE_REF_RE =
  /[（(]?\s*(?:(?:详见|参见|见|如)\s*)?图\s*(\d+(?:[.\-]\d+)*)\s*(?:所示|流程|示意|说明)?\s*[)）]?/g;

// Matches inline table references like "见表3.2.6", "（表4.4）", "如表2.1所示".
const TABLE_REF_RE =
  /[（(]?\s*(?:(?:详见|参见|见|如)\s*)?表\s*(\d+(?:[.\-]\d+)*)\s*(?:所示|详见|说明)?\s*[)）]?/g;

/**
 * Collect all figure references from the text, remove them from their original
 * positions, and append them as "(见图1)(见图2)" at the end of each paragraph
 * or list item where they appeared.
 */
function normalizeFigureReferences(text: string): string {
  // First pass: collect all unique figure IDs in order of appearance
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

  // Build a map from original figure ID to sequential number
  const figNumMap = new Map<string, number>();
  allFigIds.forEach((id, idx) => figNumMap.set(id, idx + 1));

  // Process line by line
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    // Collect figure refs on this line
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

    // Remove figure references from the line
    let cleaned = line.replace(
      new RegExp(FIGURE_REF_RE.source, FIGURE_REF_RE.flags),
      ""
    );
    // Clean up leftover empty parentheses and extra spaces
    cleaned = cleaned.replace(/[（(]\s*[)）]/g, "");
    cleaned = cleaned.replace(/\s{2,}/g, " ");
    cleaned = cleaned.trimEnd();

    // Append normalized references at the end
    const refs = lineRefs.map((n) => `(见图${n})`).join("");
    result.push(`${cleaned}${refs}`);
  }

  return result.join("\n");
}

/**
 * Normalize table references to trailing "(见表N)" labels.
 */
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

/**
 * Remove bare section-number artifacts like "(3.2.6)" / "（4.4说明）" that
 * reduce readability but carry no user-facing meaning.
 */
function stripSectionNumberArtifacts(text: string): string {
  const SECTION_ARTIFACT_RE =
    /[（(]\s*\d+(?:\.\d+){1,4}(?:\s*(?:说明|详见|详述|条款|条|节|项|第\s*\d+\s*[条款节项]))?\s*[)）]/g;
  const LEGAL_CONTEXT_RE =
    /(GB\/T|GB\s*\/\s*T|CJJ|JGJ|规范|标准|条文|条款|第\s*\d+\s*[条款节项]|见第\s*\d+\s*[条款节项])/i;

  const shouldPreserveArtifact = (segment: string, start: number, end: number): boolean => {
    const context = segment.slice(Math.max(0, start - 20), Math.min(segment.length, end + 20));
    return LEGAL_CONTEXT_RE.test(context);
  };

  return transformUnprotected(text, (seg) =>
    seg
      .replace(SECTION_ARTIFACT_RE, (match, offset: number) => {
        const start = Number(offset || 0);
        const end = start + match.length;
        if (shouldPreserveArtifact(seg, start, end)) return match;
        return "";
      })
      // Remove empty/noise parentheses left by aggressive section cleanup,
      // e.g. "（，）", "(,)", "（；）".
      .replace(/[（(]\s*[，,、；;:：。.\-]*\s*[)）]/g, "")
      .replace(/[ \t]{2,}/g, " ")
  );
}

// ---------------------------------------------------------------------------
// 4. Section scaffold normalization
// ---------------------------------------------------------------------------

/**
 * When the model outputs only level-3 section headings (e.g. "### 1. ...")
 * without top-level guidance, inject a stable two-layer scaffold:
 * - ## 检索综述 (for pre-analysis prose before first section)
 * - ## 详细解析 (before detailed section headings)
 */
function normalizeSectionScaffold(text: string): string {
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

  const summary = lines
    .slice(0, firstDetailedHeadingIndex)
    .join("\n")
    .trim();
  const detailed = lines
    .slice(firstDetailedHeadingIndex)
    .join("\n")
    .trim();

  if (!detailed) return text;

  const out: string[] = [];
  if (summary) {
    out.push("## 检索综述", "", summary, "");
  }
  out.push("## 详细解析", "", detailed);

  return out.join("\n");
}

/**
 * Renumber "### 1. ..." style headings to be sequential (1..N) when the model
 * repeats "1." for multiple sections or otherwise emits non-sequential indices.
 */
function normalizeNumberedHeadingSequence(text: string): string {
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
    if (!hasDuplicate && isSequentialFromOne) {
      return;
    }
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

    // Keep numbering state within each major section. If no H2 exists before,
    // treat the whole answer as one block.
    if (blockStart === -1) blockStart = 0;
    blockMatches.push({ index: i, title: m[2].trim(), number: Number(m[1]) });
  }

  normalizeBlock();

  return changed ? lines.join("\n") : text;
}

/**
 * Promote "核心结论：..." / "结论：..." lines into a top-level section heading so it
 * renders at the same level as "检索综述/详细解析".
 *
 * We only run when no existing conclusion heading is present.
 */
function normalizeConclusionHeading(text: string): string {
  if (!text) return text;

  // If the answer already has a top-level conclusion heading, do nothing.
  if (/^##\s*(?:核心结论|结论|总结|小结)\b/m.test(text)) return text;

  const segments = text.split(INLINE_OR_FENCED_CODE_RE);
  let replaced = false;

  const markerRe =
    /(?:^|\n)([ \t]*)(?:[-*+]\s+)?(?:\*\*)?(核心结论|结论|总结|小结)(?:\*\*)?\s*[：:]\s*/;

  const inlineRe =
    /([。！？.!?])\s*(?:\*\*)?(核心结论|结论|总结|小结)(?:\*\*)?\s*[：:]\s*/;

  const normalizeSegment = (segment: string): string => {
    if (replaced) return segment;

    // 1) Line-start marker: turn into "## 结论" and keep the remainder as body.
    const m = segment.match(markerRe);
    if (m) {
      replaced = true;
      return segment.replace(markerRe, "\n\n## 结论\n\n");
    }

    // 2) Inline marker after sentence-ending punctuation: split into new section.
    const im = segment.match(inlineRe);
    if (im) {
      replaced = true;
      return segment.replace(inlineRe, `$1\n\n## 结论\n\n`);
    }

    return segment;
  };

  const out = segments
    .map((segment, idx) => (idx % 2 === 1 ? segment : normalizeSegment(segment)))
    .join("");

  return out;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function normalizeAnswerMarkdownArtifacts(
  text: string,
  options: NormalizeAnswerMarkdownArtifactsOptions = {}
): string {
  if (!text) return text;

  const streaming = Boolean(options.streaming);
  const preserveInlineFigureRefs = options.preserveInlineFigureRefs !== false;
  const diagnostics = createDiagnostics(Boolean(options.debugDiagnostics));

  let out = text;

  // Strip leaked <think> / </think> tags that may appear during streaming.
  out = out.replace(/<\/?think>/gi, "");

  // Zero-width spaces/joiners (often introduced by copy/paste or model tokenization).
  out = out.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // Recover known malformed RAG image URLs (e.g. "?$ref=images$/...") so
  // markdown image nodes remain renderable after server-side finalization.
  const beforeRagImageRefFix = out;
  out = normalizeBrokenRagImageRefs(out);
  bumpIfChanged(diagnostics, "normalize-rag-image-ref-urls", beforeRagImageRefFix, out);

  // Parse into structural blocks early so later passes can migrate to block-scoped
  // logic without changing this public API entry point.
  const beforeBlockParser = out;
  out = runBlockParserStage(out, diagnostics);
  bumpIfChanged(diagnostics, "block-parser-roundtrip", beforeBlockParser, out);

  // Normalize escaped/non-dollar LaTeX delimiters into remark-math friendly forms.
  const beforeMathDelimiters = out;
  out = normalizeMathDelimitersForRenderer(out);
  bumpIfChanged(diagnostics, "normalize-math-delimiters", beforeMathDelimiters, out);

  // Image markdown/HTML should never stay wrapped in $...$ / $$...$$ or it
  // gets routed into remark-math instead of <img>.
  const beforeImageMathUnwrap = out;
  out = unwrapMathWrappedImages(out);
  bumpIfChanged(diagnostics, "unwrap-image-math-wrappers", beforeImageMathUnwrap, out);

  // Drop markdown/html image tokens that cannot render in the QA UI so
  // streaming output doesn't show broken-image placeholders before source-based
  // image injection runs at completion.
  const beforeStripBrokenImages = out;
  out = stripUnrenderableImageTokens(out, diagnostics);
  bumpIfChanged(diagnostics, "strip-unrenderable-image-tokens", beforeStripBrokenImages, out);

  // Fullwidth / lookalike asterisks that users visually read as "**".
  // Protect LaTeX regions so that ∗ inside formulas is not replaced.
  out = transformUnprotected(out, (seg) => seg.replace(/[＊∗﹡]/g, "*"));

  // Tighten whitespace *inside* bold delimiters: "** foo **" -> "**foo**".
  // Keep this line-local to avoid unexpected cross-paragraph matches.
  out = transformUnprotected(out, (seg) =>
    seg.replace(/\*\*\s+([^\n*]+?)\s+\*\*/g, "**$1**")
  );
  bumpIfChanged(diagnostics, "tighten-bold-whitespace", text, out);
  // Replace markdown star-run placeholders like "****" with readable fallback text.
  const beforeStars = out;
  out = normalizeStarRunPlaceholders(out);
  bumpIfChanged(diagnostics, "normalize-star-run-placeholders", beforeStars, out);
  // Split "1.xxx2.yyy3.zzz" run-on items into list-friendly lines.
  const beforeNumberedItems = out;
  out = splitRunOnNumberedItems(out);
  bumpIfChanged(diagnostics, "split-run-on-numbered-items", beforeNumberedItems, out);
  // Split malformed heading lines like "## 二、核心指标测算1.避难容量".
  const beforeInlineHeadingSplit = out;
  out = splitHeadingAndInlineNumberedSubitem(out, diagnostics);
  bumpIfChanged(diagnostics, "split-inline-heading", beforeInlineHeadingSplit, out);

  // Upgrade loose pipe-delimited table text into valid multi-line GFM table
  // blocks; keep streaming mode conservative (no heavy rewrites).
  const beforeLooseTables = out;
  out = normalizeLoosePipeTables(out, { diagnostics, streaming });
  bumpIfChanged(diagnostics, "normalize-loose-pipe-tables", beforeLooseTables, out);

  // Convert Chinese-style headings to Markdown headings (must run before list fix).
  const beforeChineseHeadings = out;
  out = normalizeChineseHeadings(out, diagnostics);
  bumpIfChanged(diagnostics, "normalize-chinese-headings", beforeChineseHeadings, out);
  if (!streaming) {
    // Demote heading-like first line under "相关概念" to paragraph/body text.
    const beforeRelatedConcepts = out;
    out = normalizeRelatedConceptsBody(out);
    bumpIfChanged(diagnostics, "normalize-related-concepts-body", beforeRelatedConcepts, out);
    // Normalize markdown heading spacing/levels and demote sentence-like pseudo-headings.
    const beforeHeadingHierarchy = out;
    out = normalizeMarkdownHeadingHierarchy(out, diagnostics);
    bumpIfChanged(diagnostics, "normalize-heading-hierarchy", beforeHeadingHierarchy, out);
  }

  // Normalize unicode bullets that users visually read as lists but markdown won't parse.
  out = out.replace(/^[ \t]*[•·]\s+/gm, "- ");

  // Ensure blank line AFTER markdown headings so the next line is parsed as
  // a separate paragraph rather than being swallowed into the heading node.
  out = out.replace(/^(#{1,6}\s+.+)\n(?!\s*$)/gm, "$1\n\n");

  // Ensure blank line before the *first* list item that follows a non-list,
  // non-blank line.  We must NOT insert blank lines between consecutive list
  // items (that would break the list into separate single-item lists).
  // Pattern: a line that is NOT itself a list item, followed by a list item.
  out = out.replace(
    /^([ \t]*(?![-*+]\s)(?!\d+[.)]\s)\S[^\n]*)\n([ \t]*(?:[-*+]|\d+[.)])\s)/gm,
    "$1\n\n$2"
  );

  // Fix ordered list numbering (1. 1. 1. → 1. 2. 3.).
  out = normalizeMarkdownLists(out);
  bumpCounter(diagnostics, "normalize-markdown-lists");

  // Optional: normalize figure references only when explicitly requested.
  if (!preserveInlineFigureRefs) {
    const beforeFigureRefs = out;
    out = normalizeFigureReferences(out);
    bumpIfChanged(diagnostics, "normalize-figure-references", beforeFigureRefs, out);
  }
  // Normalize table references: "表3.2.6" / "见表3.2.6" → trailing "(见表1)".
  if (!streaming) {
    const beforeTableRefs = out;
    out = normalizeTableReferences(out);
    bumpIfChanged(diagnostics, "normalize-table-references", beforeTableRefs, out);
    // Remove dangling section-id noise like "(3.2.6)".
    const beforeSectionArtifacts = out;
    out = stripSectionNumberArtifacts(out);
    bumpIfChanged(diagnostics, "strip-section-number-artifacts", beforeSectionArtifacts, out);
  }

  // Ensure a stable heading scaffold when only detailed sub-headings are present.
  if (!streaming) {
    const beforeScaffold = out;
    out = normalizeSectionScaffold(out);
    bumpIfChanged(diagnostics, "normalize-section-scaffold", beforeScaffold, out);
  }

  // Fix repeated "1." (or non-sequential) numbering in section headings.
  out = normalizeNumberedHeadingSequence(out);
  bumpCounter(diagnostics, "normalize-numbered-heading-sequence");

  if (!streaming) {
    // Promote obvious bare formula lines to display-math blocks so they render
    // with dedicated KaTeX styles instead of raw LaTeX/plain text.
    const beforeFormulaPromotion = out;
    out = promoteBareFormulaParagraphs(out, diagnostics);
    bumpIfChanged(diagnostics, "promote-bare-formula-paragraphs", beforeFormulaPromotion, out);
  }

  // Promote "核心结论：" marker into top-level heading (if needed).
  if (!streaming) {
    const beforeConclusion = out;
    out = normalizeConclusionHeading(out);
    bumpIfChanged(diagnostics, "normalize-conclusion-heading", beforeConclusion, out);
  }

  // Normalize "~~" used as a numeric range delimiter while preserving real markdown
  // strikethrough and code snippets.
  out = normalizeNumericRangeDelimiters(out);
  bumpCounter(diagnostics, "normalize-numeric-range-delimiters");

  if (!streaming) {
    // Final pass: recover malformed `$...$` spans that would otherwise leak raw
    // LaTeX commands into the UI instead of rendering or readable fallback text.
    const beforeBrokenMath = out;
    out = normalizeBrokenInlineMath(out);
    bumpIfChanged(diagnostics, "normalize-broken-inline-math", beforeBrokenMath, out);
  }

  if (diagnostics.enabled) {
    // eslint-disable-next-line no-console
    console.debug("[qa.normalizeAnswerMarkdownArtifacts]", diagnostics);
  }

  return out;
}
