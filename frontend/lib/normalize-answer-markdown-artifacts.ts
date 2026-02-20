/**
 * Normalize common LLM/OCR artifacts that break markdown rendering in our UI.
 *
 * This is the single source of truth for answer text normalization used by
 * qa-panel.tsx and qa-shell.tsx.
 */

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
}

/**
 * Regex that matches LaTeX delimiters ($...$, $$...$$) AND code blocks.
 * Used to split text so that destructive normalizations skip protected regions.
 */
const PROTECTED_REGION_RE = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|```[\s\S]*?```|`[^`\n]*`)/g;

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
        // Avoid touching table rows.
        if (line.includes("|")) return line;

        // Ensure "1.文本" -> "1. 文本" at line start.
        let normalized = line.replace(/^([ \t]*\d{1,2}[.．])(?=[^\s\d])/, "$1 ");
        const markerRe = /\d{1,2}[.．](?=\s*[^\s\d])/g;
        const matches = Array.from(normalized.matchAll(markerRe));
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

function splitHeadingAndInlineNumberedSubitem(text: string): string {
  return transformUnprotected(text, (seg) => {
    const lines = seg.split("\n");
    return lines
      .map((line) => {
        const markdownHeadingMatch = line.match(/^(#{2,4}\s+[^\n#]*?)(\d{1,2}[.．](?=[^\s\d]).*)$/);
        const chineseHeadingMatch = line.match(/^(\s*[一二三四五六七八九十]+[、.．]\s*[^\n]*?)(\d{1,2}[.．](?=[^\s\d]).*)$/);
        const m = markdownHeadingMatch || chineseHeadingMatch;
        if (!m) return line;

        const headingPart = (m[1] || "").trimEnd();
        const subitemPart = (m[2] || "").trimStart();
        const headingTail = headingPart.slice(-1);

        // Avoid splitting cases where heading naturally ends with a digit (e.g. version numbers).
        if (/\d/.test(headingTail)) return line;
        if (!/[\u4e00-\u9fffA-Za-z）)]/.test(headingTail)) return line;

        const normalizedSubitem = subitemPart.replace(/^(\d{1,2}[.．])(?=[^\s\d])/, "$1 ");
        return `${headingPart}\n${normalizedSubitem}`;
      })
      .join("\n");
  });
}

function normalizeLoosePipeTables(text: string): string {
  return transformUnprotected(text, (seg) => {
    const lines = seg.split("\n");
    return lines
      .map((line) => {
        if (!line.includes("|")) return line;
        if (/^\s*\|.+\|\s*$/.test(line.trim())) return line;

        const tokens = line
          .split("|")
          .map((t) => t.trim())
          .filter(Boolean);
        if (tokens.length < 6) return line;

        const sepStart = tokens.findIndex((t) => /^[-:]{3,}$/.test(t));
        if (sepStart < 2) return line;

        const cols = sepStart;
        const sepTokens = tokens.slice(sepStart, sepStart + cols);
        if (sepTokens.length !== cols || sepTokens.some((t) => !/^[-:]{3,}$/.test(t))) {
          return line;
        }

        const body = tokens.slice(sepStart + cols);
        if (body.length < cols) return line;

        const rows: string[] = [];
        for (let i = 0; i < body.length; i += cols) {
          const row = body.slice(i, i + cols);
          if (row.length !== cols) break;
          rows.push(`| ${row.join(" | ")} |`);
        }
        if (rows.length === 0) return line;

        return [
          `| ${tokens.slice(0, cols).join(" | ")} |`,
          `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`,
          ...rows,
        ].join("\n");
      })
      .join("\n");
  });
}

const HEADING_LINE_RE = /^(#{1,6})\s*(.*?)\s*$/;
const HEADING_CN_SECTION_RE = /^[一二三四五六七八九十]+[、.．]\s*/;
const HEADING_CN_SUBSECTION_RE = /^[（(][一二三四五六七八九十]+[)）]\s*/;
const HEADING_NUM_SECTION_RE = /^\d{1,2}[.、．]\s*/;
const HEADING_NUM_SUBSECTION_RE = /^(?:\d+[)）]|[\u2460-\u2469])\s*/;
const HEADING_CAPTION_RE = /^(?:图|表)\s*\d+(?:\.\d+)*\s*[：:]/;

function normalizeMarkdownHeadingHierarchy(text: string): string {
  const lines = text.split("\n");
  const normalized = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    const match = trimmed.match(HEADING_LINE_RE);
    if (!match) return line;

    const originalLevel = match[1].length;
    const rawTitle = (match[2] || "").trim();
    const semanticTitle = normalizeHeadingTitle(rawTitle);
    if (!semanticTitle) return "";

    const semanticHeading =
      MAJOR_SECTION_TITLE_RE.test(semanticTitle) ||
      HEADING_CN_SECTION_RE.test(semanticTitle) ||
      HEADING_CN_SUBSECTION_RE.test(semanticTitle) ||
      HEADING_NUM_SECTION_RE.test(semanticTitle) ||
      HEADING_NUM_SUBSECTION_RE.test(semanticTitle);

    // Demote headings that are clearly full sentences or figure/table captions.
    const startsLikeStructuredHeading =
      HEADING_CN_SECTION_RE.test(semanticTitle) ||
      HEADING_CN_SUBSECTION_RE.test(semanticTitle) ||
      HEADING_NUM_SECTION_RE.test(semanticTitle) ||
      HEADING_NUM_SUBSECTION_RE.test(semanticTitle);

    // Keep heading normalization conservative:
    // - always demote figure/table captions;
    // - demote very long punctuation-heavy sentence-like pseudo headings;
    // - keep numbered/structured headings intact.
    const looksLikeBodySentence =
      HEADING_CAPTION_RE.test(semanticTitle) ||
      (!startsLikeStructuredHeading &&
        semanticTitle.length >= 32 &&
        /[，,:：；。！？]/.test(semanticTitle));

    // Demote sentence-like pseudo-headings so content/body no longer renders as title.
    if (!semanticHeading && looksLikeBodySentence) {
      return semanticTitle;
    }

    let level = originalLevel;
    if (MAJOR_SECTION_TITLE_RE.test(semanticTitle)) level = 2;

    level = Math.max(2, Math.min(6, level));
    return `${"#".repeat(level)} ${rawTitle}`;
  });

  const out: string[] = [];
  let prevHeadingLevel = 0;
  for (const line of normalized) {
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

// Chinese numeral map for heading detection
const CN_NUMERALS: Record<string, number> = {
  "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
  "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
  "十一": 11, "十二": 12, "十三": 13, "十四": 14, "十五": 15,
};

// Level-1: "一、标题" or "**一、标题**" (standalone line)
const CN_H1_RE = /^(?:\*{2})?\s*([一二三四五六七八九十]+)[、.．]\s*(.+?)(?:\*{2})?\s*$/;
// Level-2: "（一）标题" or "(一) 标题" or "**（一）标题**"
const CN_H2_RE = /^(?:\*{2})?\s*[（(]\s*([一二三四五六七八九十]+)\s*[)）]\s*(.+?)(?:\*{2})?\s*$/;
// Level-2 alt: "1. 标题" / "1、标题" at top-level that looks like a section heading
// (only when it doesn't look like part of an ordered list)
const NUM_H2_RE = /^\s*(\d{1,2})[.、．]\s*(.+?)\s*$/;
// Level-3: "1) 标题" or "①标题"
const CIRCLED_DIGITS: Record<string, number> = {
  "\u2460": 1, "\u2461": 2, "\u2462": 3, "\u2463": 4, "\u2464": 5,
  "\u2465": 6, "\u2466": 7, "\u2467": 8, "\u2468": 9, "\u2469": 10,
};
const CN_H3_RE = /^(?:\*{2})?\s*(\d+)[)）]\s*(.+?)(?:\*{2})?\s*$/;
const CIRCLED_H3_RE = /^(?:\*{2})?\s*([\u2460-\u2469])\s*(.+?)(?:\*{2})?\s*$/;

/**
 * Convert Chinese-style headings to Markdown headings.
 * Processes line-by-line; only converts lines that look like standalone headings.
 */
function normalizeChineseHeadings(text: string): string {
  const lines = text.split("\n");
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

    // Level-1: 一、标题
    let match = trimmed.match(CN_H1_RE);
    if (match && match[2].length <= 60) {
      // Preserve numbering for better reading guidance (e.g., "一、...").
      result.push(`## ${match[1]}、${match[2].trim()}`);
      continue;
    }

    // Level-2: （一）标题
    match = trimmed.match(CN_H2_RE);
    if (match && match[2].length <= 60) {
      result.push(`### （${match[1]}）${match[2].trim()}`);
      continue;
    }

    // Level-2 alt: "1. 标题" / "1、标题" used as a section header (not a list item).
    match = trimmed.match(NUM_H2_RE);
    if (match) {
      const title = match[2].trim();
      const prev = prevNonEmptyLine(idx);
      const next = nextNonEmptyLine(idx);

      const looksLikeListNeighbor =
        (prev ? NUM_H2_RE.test(prev) : false) || (next ? NUM_H2_RE.test(next) : false);

      const nextLooksLikeBody =
        next
          ? /^[-*+•]\s+/.test(next) ||
            /^\d+[.)]\s+/.test(next) ||
            /^\s{2,}[-*+•]\s+/.test(next)
          : false;

      const looksLikeHeadingText =
        title.length > 0 &&
        title.length <= 80 &&
        !/[。！？；]$/.test(title);

      if (!looksLikeListNeighbor && looksLikeHeadingText && (nextLooksLikeBody || Boolean(next))) {
        result.push(`### ${match[1]}. ${title}`);
        continue;
      }
    }

    // Level-3: 1) 标题 or ① 标题
    match = trimmed.match(CN_H3_RE);
    if (match && match[2].length <= 80 && !/[。！？；]$/.test(match[2])) {
      result.push(`#### ${match[1]}) ${match[2].trim()}`);
      continue;
    }

    match = trimmed.match(CIRCLED_H3_RE);
    if (match && match[2].length <= 80 && !/[。！？；]$/.test(match[2])) {
      result.push(`#### ${match[1]} ${match[2].trim()}`);
      continue;
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
  const lines = content.split(/\r?\n/);
  let activeIndent = "";
  let orderedCounter = 0;

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
      if (/^\S/.test(line)) {
        orderedCounter = 0;
        activeIndent = "";
      }

      return line;
    })
    .join("\n");
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
  return transformUnprotected(text, (seg) =>
    seg
      .replace(
        /[（(]\s*\d+(?:\.\d+){1,4}(?:\s*(?:说明|详见|详述|条款|条|节|项|第\s*\d+\s*[条款节项]))?\s*[)）]/g,
        ""
      )
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

  let out = text;

  // Strip leaked <think> / </think> tags that may appear during streaming.
  out = out.replace(/<\/?think>/gi, "");

  // Zero-width spaces/joiners (often introduced by copy/paste or model tokenization).
  out = out.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // Fullwidth / lookalike asterisks that users visually read as "**".
  // Protect LaTeX regions so that ∗ inside formulas is not replaced.
  out = transformUnprotected(out, (seg) => seg.replace(/[＊∗﹡]/g, "*"));

  // Tighten whitespace *inside* bold delimiters: "** foo **" -> "**foo**".
  // Keep this line-local to avoid unexpected cross-paragraph matches.
  out = transformUnprotected(out, (seg) =>
    seg.replace(/\*\*\s+([^\n*]+?)\s+\*\*/g, "**$1**")
  );
  // Replace markdown star-run placeholders like "****" with readable fallback text.
  out = normalizeStarRunPlaceholders(out);
  // Split "1.xxx2.yyy3.zzz" run-on items into list-friendly lines.
  out = splitRunOnNumberedItems(out);
  // Split malformed heading lines like "## 二、核心指标测算1.避难容量".
  out = splitHeadingAndInlineNumberedSubitem(out);

  if (!streaming) {
    // Upgrade loose pipe-delimited table text into valid multi-line GFM table blocks.
    out = normalizeLoosePipeTables(out);
  }

  // Convert Chinese-style headings to Markdown headings (must run before list fix).
  out = normalizeChineseHeadings(out);
  if (!streaming) {
    // Demote heading-like first line under "相关概念" to paragraph/body text.
    out = normalizeRelatedConceptsBody(out);
    // Normalize markdown heading spacing/levels and demote sentence-like pseudo-headings.
    out = normalizeMarkdownHeadingHierarchy(out);
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

  // Optional: normalize figure references only when explicitly requested.
  if (!preserveInlineFigureRefs) {
    out = normalizeFigureReferences(out);
  }
  // Normalize table references: "表3.2.6" / "见表3.2.6" → trailing "(见表1)".
  if (!streaming) {
    out = normalizeTableReferences(out);
    // Remove dangling section-id noise like "(3.2.6)".
    out = stripSectionNumberArtifacts(out);
  }

  // Ensure a stable heading scaffold when only detailed sub-headings are present.
  if (!streaming) {
    out = normalizeSectionScaffold(out);
  }

  // Fix repeated "1." (or non-sequential) numbering in section headings.
  out = normalizeNumberedHeadingSequence(out);

  // Promote "核心结论：" marker into top-level heading (if needed).
  if (!streaming) {
    out = normalizeConclusionHeading(out);
  }

  // Normalize "~~" used as a numeric range delimiter while preserving real markdown
  // strikethrough and code snippets.
  out = normalizeNumericRangeDelimiters(out);

  return out;
}
