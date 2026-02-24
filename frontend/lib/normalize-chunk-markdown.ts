function splitRunOnNumberedHeadings(text: string): string {
  // Insert a newline before deeper numbered headings (x.y.z...) that appear mid-line.
  // Example: "4.2指标体系 4.2.1城市..." -> "4.2指标体系\n4.2.1城市..."
  return text.replace(/\s+(\d+\.\d+\.\d+(?:\.\d+)*)(?=[^\s])/g, "\n$1");
}

function splitLeadingSlideTitle(text: string): string {
  // PPT-like docs often begin with a slide number + title on the same line as the body text.
  // Example: "05地块信息一览表（GHJ街坊） 根据..." -> "05地块信息一览表（GHJ街坊）\n根据..."
  const trimmed = text.trimStart();
  const m = trimmed.match(/^(\d{2})\s*([^\n]{4,80})$/);
  if (!m) return text;

  // Only try splitting when this is a single-line chunk.
  if (trimmed.includes("\n")) return text;

  // Find a natural boundary: after a closing paren/bracket in the first part.
  const boundaryChars = [")", "）", "】", "]", "》", "」", "』"];
  let boundaryIdx = -1;
  for (const ch of boundaryChars) {
    const idx = trimmed.indexOf(ch);
    if (idx !== -1 && idx < 60) {
      boundaryIdx = idx + 1;
      break;
    }
  }

  if (boundaryIdx === -1) {
    // Fallback: split at first whitespace after ~10 characters.
    const ws = trimmed.slice(0, 60).match(/\s+/);
    if (ws?.index !== undefined && ws.index >= 10) {
      boundaryIdx = ws.index;
    }
  }

  if (boundaryIdx === -1) return text;

  const left = trimmed.slice(0, boundaryIdx).trim();
  const right = trimmed.slice(boundaryIdx).trim();
  if (!left || right.length < 10) return text;

  return `${left}\n${right}`;
}

function normalizeHeadingLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // OCR/HTML sometimes outputs headings as a full-line bold span.
  const unwrapped = trimmed.replace(/^\*\*(.+)\*\*$/, "$1").trim();

  // Major headings: "4.标题" (requires the dot)
  // Subheadings: "4.1标题" / "4.1.1标题" (dot between digits, no trailing dot required)
  const match = unwrapped.match(/^(\d+(?:\.\d+)*)([.．。])?\s*(.+)$/);
  if (!match) return null;

  const number = match[1];
  const trailingDot = match[2] || "";
  const title = (match[3] || "").trim();
  if (!title) return null;

  const dotCount = (number.match(/\./g) || []).length;

  // Require "N." for top-level headings; avoids converting list-like lines such as "1 内容".
  if (dotCount === 0 && !trailingDot) return null;

  if (dotCount === 0) return `## ${number}. ${title}`;
  if (dotCount === 1) return `### ${number} ${title}`;
  return `#### ${number} ${title}`;
}

export function normalizeChunkMarkdown(text: string): string {
  if (!text) return text;

  // Remove raw <strong> wrappers that often cause "everything is bold" in OCR chunks.
  let processed = text.replace(/<\/?strong>/gi, "");

  // Some OCR pipelines wrap the entire chunk in a single bold span: **...**.
  // Unwrap before inserting newlines; otherwise the markers end up split across lines.
  const trimmed = processed.trim();
  if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
    const markerCount = (trimmed.match(/\*\*/g) || []).length;
    if (markerCount === 2) {
      processed = trimmed.slice(2, -2);
    }
  }

  processed = splitRunOnNumberedHeadings(processed);
  processed = splitLeadingSlideTitle(processed);

  const lines = processed.split(/\r?\n/);
  const normalized = lines.map((line) => {
    const maybe = normalizeHeadingLine(line);
    if (maybe) return maybe;

    // PPT-style headings: "05地块信息一览表 (...)" / "04地块编号"
    const trimmed = line.trim();
    const pptMatch = trimmed.match(/^(\d{2})\s*([^\d].{2,80})$/);
    if (pptMatch) {
      const num = pptMatch[1];
      const title = (pptMatch[2] || "").trim();
      // Avoid turning short/ambiguous tokens into headings.
      if (title.length >= 4) return `## ${num} ${title}`;
    }

    return line;
  });
  return normalized.join("\n");
}
