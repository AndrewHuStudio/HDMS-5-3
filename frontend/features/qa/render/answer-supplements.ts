export interface AnswerSupplement {
  id: string;
  title: string;
  markdown: string;
  source: "blockquote" | "paragraph";
}

export interface SplitAnswerSupplementsResult {
  markdown: string;
  supplements: AnswerSupplement[];
}

const SUPPLEMENT_LINE_RE = /^补充(?:说明|信息)?\s*[：:]\s*(.*)$/u;
const H2_HEADING_RE = /^##\s+\S/;

function stripQuotePrefix(line: string): string {
  let out = String(line || "");
  while (/^\s*>/.test(out)) {
    out = out.replace(/^\s*>\s?/, "");
  }
  return out;
}

function isBlankQuoteLine(line: string): boolean {
  return /^\s*>\s*$/.test(line);
}

function isSupplementStart(line: string): RegExpMatchArray | null {
  const stripped = stripQuotePrefix(line).trim();
  return stripped.match(SUPPLEMENT_LINE_RE);
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]?.trim()) start += 1;
  while (end > start && !lines[end - 1]?.trim()) end -= 1;
  return lines.slice(start, end);
}

function normalizeMarkdownSpacing(lines: string[]): string {
  const out: string[] = [];
  let blankRun = 0;

  for (const line of lines) {
    if (!line.trim()) {
      blankRun += 1;
      if (blankRun > 2) continue;
      out.push("");
      continue;
    }
    blankRun = 0;
    out.push(line);
  }

  return trimBlankEdges(out).join("\n");
}

export function splitAnswerSupplements(markdown: string): SplitAnswerSupplementsResult {
  if (!markdown.trim()) {
    return { markdown, supplements: [] };
  }

  const lines = markdown.split("\n");
  const main: string[] = [];
  const supplements: AnswerSupplement[] = [];

  let i = 0;
  while (i < lines.length) {
    const current = lines[i] ?? "";
    const startMatch = isSupplementStart(current);
    if (!startMatch) {
      main.push(current);
      i += 1;
      continue;
    }

    const quoteMode = /^\s*>/.test(current);

    if (quoteMode) {
      while (main.length > 0 && isBlankQuoteLine(main[main.length - 1] ?? "")) {
        main.pop();
      }
    } else {
      while (main.length > 0 && !main[main.length - 1]?.trim()) {
        main.pop();
      }
    }

    const bodyLines: string[] = [];
    const firstBody = (startMatch[1] || "").trim();
    if (firstBody) bodyLines.push(firstBody);

    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      const nextIsQuote = /^\s*>/.test(next);
      const nextStripped = quoteMode ? stripQuotePrefix(next) : next;
      const nextTrimmed = nextStripped.trim();

      if (H2_HEADING_RE.test(nextTrimmed)) break;
      if (!quoteMode && isSupplementStart(next)) break;
      if (quoteMode && !nextIsQuote) break;

      if (!nextTrimmed) {
        const lookahead = lines[i + 1] ?? "";
        const lookaheadIsQuote = /^\s*>/.test(lookahead);
        const lookaheadTrimmed = (quoteMode ? stripQuotePrefix(lookahead) : lookahead).trim();
        if (!lookaheadTrimmed || H2_HEADING_RE.test(lookaheadTrimmed) || (quoteMode && !lookaheadIsQuote)) {
          i += 1;
          break;
        }
        bodyLines.push("");
        i += 1;
        continue;
      }

      bodyLines.push(nextStripped.trimEnd());
      i += 1;
    }

    while (i < lines.length) {
      const trailing = lines[i] ?? "";
      if (!trailing.trim()) {
        i += 1;
        continue;
      }
      if (quoteMode && isBlankQuoteLine(trailing)) {
        i += 1;
        continue;
      }
      break;
    }

    const normalizedBody = normalizeMarkdownSpacing(bodyLines);
    if (!normalizedBody) {
      continue;
    }

    supplements.push({
      id: `supplement-${supplements.length + 1}`,
      title: "补充说明",
      markdown: normalizedBody,
      source: quoteMode ? "blockquote" : "paragraph",
    });
  }

  return {
    markdown: normalizeMarkdownSpacing(main),
    supplements,
  };
}
