const TABLE_RE = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<\/?[^>]+>/g;

function decodeHtmlEntities(text: string): string {
  // Keep this minimal and deterministic (no DOMParser in Node/test env).
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function cleanCellHtml(cellHtml: string): string {
  const withoutBreaks = cellHtml.replace(BR_RE, " / ");
  const withoutTags = withoutBreaks.replace(TAG_RE, "");
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded.replace(/\s+/g, " ").trim();
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function htmlTableToMarkdown(html: string): string | null {
  const rows: { cells: string[]; header: boolean }[] = [];

  for (const rowMatch of html.matchAll(ROW_RE)) {
    const rowHtml = rowMatch[1] ?? "";
    const cells: string[] = [];
    let hasTh = false;

    for (const cellMatch of rowHtml.matchAll(CELL_RE)) {
      const tag = (cellMatch[1] ?? "").toLowerCase();
      const inner = cellMatch[2] ?? "";
      if (tag === "th") hasTh = true;
      cells.push(escapePipes(cleanCellHtml(inner)));
    }

    if (cells.length > 0) rows.push({ cells, header: hasTh });
  }

  if (rows.length === 0) return null;

  const maxCols = Math.max(...rows.map((r) => r.cells.length));
  for (const r of rows) {
    while (r.cells.length < maxCols) r.cells.push("");
  }

  const headerRow = rows.find((r) => r.header) ?? rows[0];
  const headerCells = headerRow.cells.map((c) => c || " ");
  const separatorCells = Array.from({ length: maxCols }, () => "---");

  const bodyRows = rows.filter((r) => r !== headerRow);

  const lines: string[] = [];
  lines.push(`| ${headerCells.join(" | ")} |`);
  lines.push(`| ${separatorCells.join(" | ")} |`);
  for (const r of bodyRows) {
    lines.push(`| ${r.cells.join(" | ")} |`);
  }

  return `\n\n${lines.join("\n")}\n\n`;
}

/**
 * Convert HTML <table> blocks produced by the LLM into GFM markdown tables so
 * our markdown renderer can display them without enabling raw HTML rendering.
 */
export function normalizeAnswerTables(text: string): string {
  if (!text || !TABLE_RE.test(text)) return text;
  TABLE_RE.lastIndex = 0;

  return text.replace(TABLE_RE, (match) => htmlTableToMarkdown(match) ?? match);
}

