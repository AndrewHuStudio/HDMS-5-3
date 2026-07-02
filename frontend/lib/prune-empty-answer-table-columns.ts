const TABLE_HEADER_RE = /^\s*\|.+\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function parseTableRow(line: string): string[] | null {
  const trimmed = String(line || "").trim();
  if (!TABLE_HEADER_RE.test(trimmed)) return null;
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function serializeTableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function isEmptyCell(value: string): boolean {
  return !String(value || "").replace(/&nbsp;/gi, " ").trim();
}

function isBasisHeader(value: string): boolean {
  return /^(?:依据|图纸依据|资料依据)$/u.test(String(value || "").trim());
}

export function pruneEmptyAnswerTableColumns(text: string): string {
  if (!text || !text.includes("依据")) return text;

  const lines = text.split("\n");
  const out = [...lines];

  for (let i = 0; i < lines.length - 1; i += 1) {
    const headerLine = lines[i] ?? "";
    const separatorLine = lines[i + 1] ?? "";
    if (!TABLE_HEADER_RE.test(headerLine.trim()) || !TABLE_SEPARATOR_RE.test(separatorLine.trim())) {
      continue;
    }

    const headerCells = parseTableRow(headerLine);
    const separatorCells = parseTableRow(separatorLine);
    if (!headerCells || !separatorCells || headerCells.length !== separatorCells.length) {
      continue;
    }

    const basisColumnIndexes = headerCells
      .map((cell, idx) => (isBasisHeader(cell) ? idx : -1))
      .filter((idx) => idx >= 0);
    if (basisColumnIndexes.length === 0) continue;

    let end = i + 2;
    while (end < lines.length) {
      const row = lines[end] ?? "";
      if (!row.trim()) break;
      if (!TABLE_HEADER_RE.test(row.trim())) break;
      end += 1;
    }

    const bodyRows = lines.slice(i + 2, end).map(parseTableRow);
    if (bodyRows.some((row) => row === null || row.length !== headerCells.length)) {
      continue;
    }

    const removableIndexes = basisColumnIndexes.filter((colIdx) =>
      bodyRows.every((row) => isEmptyCell(row?.[colIdx] || "")),
    );
    if (removableIndexes.length === 0) {
      i = end - 1;
      continue;
    }

    const keep = headerCells.map((_, idx) => !removableIndexes.includes(idx));
    out[i] = serializeTableRow(headerCells.filter((_, idx) => keep[idx]));
    out[i + 1] = serializeTableRow(separatorCells.filter((_, idx) => keep[idx]));
    for (let rowIdx = i + 2; rowIdx < end; rowIdx += 1) {
      const parsed = bodyRows[rowIdx - (i + 2)]!;
      out[rowIdx] = serializeTableRow(parsed.filter((_, idx) => keep[idx]));
    }

    i = end - 1;
  }

  return out.join("\n");
}
