import type { SourceInfo } from "@/features/qa/types";

type TableCandidate = {
  markdown: string;
};

// A very small GFM table detector: header line with pipes + separator line.
const TABLE_HEADER_RE = /^\s*\|.+\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function extractFirstGfmTable(text: string): string | null {
  if (!text) return null;
  const lines = text.split("\n");

  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i] ?? "";
    const sep = lines[i + 1] ?? "";
    if (!TABLE_HEADER_RE.test(header) || !TABLE_SEPARATOR_RE.test(sep)) continue;

    let j = i + 2;
    while (j < lines.length) {
      const row = lines[j] ?? "";
      if (!row.trim()) break;
      // End table when we hit a non-row-ish line (no pipes).
      if (!row.includes("|")) break;
      j += 1;
    }

    const block = lines.slice(i, j).join("\n").trim();
    if (block) return block;
  }

  return null;
}

function buildTableCandidates(sources: SourceInfo[] | undefined): TableCandidate[] {
  if (!sources || sources.length === 0) return [];
  const out: TableCandidate[] = [];
  const seen = new Set<string>();

  for (const src of sources) {
    const direct = String(src.table_markdown || "").trim();
    const table = direct || extractFirstGfmTable(String(src.quote || ""));
    if (!table) continue;
    if (seen.has(table)) continue;
    seen.add(table);
    out.push({ markdown: table });
  }
  return out;
}

function maxTableRef(text: string): number {
  let max = 0;
  const re = /[（(]\s*见表\s*(\d{1,2})\s*[)）]/g;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function stripDanglingTableRefs(text: string): string {
  return text
    .replace(/[（(]\s*见表\s*\d{1,2}\s*[)）]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n");
}

/**
 * If the answer contains "(见表N)" but no table was rendered, append a small
 * "相关表格" section using tables extracted from retrieved sources.
 *
 * Note: This operates purely on the already-normalized answer markdown; it is
 * intentionally conservative to avoid making the reply noisier.
 */
export function injectSourceTables(text: string, sources: SourceInfo[] | undefined): string {
  if (!text || !sources || sources.length === 0) return text;

  const needed = maxTableRef(text);
  if (needed <= 0) return text;

  const candidates = buildTableCandidates(sources);
  if (candidates.length === 0) {
    // Don't show "(见表N)" if we can't actually provide any table.
    return stripDanglingTableRefs(text);
  }

  // Avoid blowing up the message; cap the appendix size.
  const count = Math.min(needed, candidates.length, 3);

  // If the answer already contains a table, don't append more.
  const alreadyHasTable = text.split("\n").some((line, idx, arr) => {
    const h = arr[idx] ?? "";
    const s = arr[idx + 1] ?? "";
    return TABLE_HEADER_RE.test(h) && TABLE_SEPARATOR_RE.test(s);
  });
  if (alreadyHasTable) return text;

  const appendix: string[] = [];
  appendix.push("", "", "### 相关表格");
  for (let i = 0; i < count; i++) {
    appendix.push("", `表${i + 1}：相关表格`, "", candidates[i]!.markdown, "");
  }

  return `${text}${appendix.join("\n")}`;
}
