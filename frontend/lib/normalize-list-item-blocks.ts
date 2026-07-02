const ORDERED_ITEM_RE = /^(\s{0,3})(\d+[.)])\s+(.+)$/;
const TABLE_ROW_RE = /^\s*\|.+\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function isTableRow(line: string): boolean {
  return TABLE_ROW_RE.test(String(line || "").trim());
}

export function normalizeListItemBlocks(text: string): string {
  if (!text || !text.includes("|")) return text;

  const lines = text.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const ordered = line.match(ORDERED_ITEM_RE);
    if (!ordered) {
      out.push(line);
      continue;
    }

    const indent = ordered[1] ?? "";
    const marker = ordered[2] ?? "1.";
    const body = ordered[3] ?? "";

    const inlineTableMatch = body.match(/^(.*?)(\s+\|.+\|)\s*$/);
    if (!inlineTableMatch) {
      out.push(line);
      continue;
    }

    const lead = (inlineTableMatch[1] || "").trimEnd();
    const inlineHeader = (inlineTableMatch[2] || "").trim();
    const nextLine = lines[i + 1] ?? "";
    if (!TABLE_SEPARATOR_RE.test(nextLine.trim())) {
      out.push(line);
      continue;
    }

    out.push(`${indent}${marker} ${lead}`);

    const blockIndent = `${indent}   `;
    out.push("");
    out.push(`${blockIndent}${inlineHeader}`);

    let j = i + 1;
    while (j < lines.length && isTableRow(lines[j] ?? "")) {
      out.push(`${blockIndent}${(lines[j] ?? "").trim()}`);
      j += 1;
    }
    out.push("");
    i = j - 1;
  }

  return out.join("\n");
}
