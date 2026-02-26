/**
 * 圆圈数字引用转锚点
 * 将正文中的 ①②③... 圆圈数字转换为 [N-M](#source-N-M) 格式的 Markdown 锚点。
 * 跳过代码块和检索综述引用块（> 开头的行），避免误转换。
 */
import type { SourceInfo } from "../../types";

const CIRCLED_NUMERALS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"] as const;

function buildDocFallbackLabelMap(sources: SourceInfo[]): Map<number, string> {
  const picked = new Map<number, { chunk: number; label: string }>();

  for (const src of sources) {
    const label = String(src.citation_label || "").trim();
    const m = label.match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) continue;

    const docNum = Number.parseInt(m[1], 10);
    const chunkNum = Number.parseInt(m[2], 10);
    if (!Number.isFinite(docNum) || !Number.isFinite(chunkNum)) continue;

    const prev = picked.get(docNum);
    if (!prev || chunkNum < prev.chunk) {
      picked.set(docNum, { chunk: chunkNum, label });
    }
  }

  const out = new Map<number, string>();
  for (const [docNum, payload] of picked.entries()) {
    out.set(docNum, payload.label);
  }
  return out;
}

/**
 * Convert circled numerals used as body references (①②...) into
 * markdown citation anchors, while keeping retrieval-overview blockquotes unchanged.
 */
export function convertCircledCitationsToAnchors(text: string, sources: SourceInfo[]): string {
  if (!text || !sources.length) return text;

  const docToLabel = buildDocFallbackLabelMap(sources);
  if (!docToLabel.size) return text;

  const lines = text.split("\n");
  const outLines: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      outLines.push(line);
      continue;
    }

    if (inFence || trimmed.startsWith(">")) {
      outLines.push(line);
      continue;
    }

    let out = "";
    let inInline = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === "`") {
        inInline = !inInline;
        out += ch;
        continue;
      }

      if (!inInline) {
        const circledIdx = CIRCLED_NUMERALS.indexOf(ch as (typeof CIRCLED_NUMERALS)[number]);
        if (circledIdx >= 0) {
          const docNum = circledIdx + 1;
          const label = docToLabel.get(docNum);
          if (label) {
            out += `[${label}](#source-${label})`;
            continue;
          }
        }
      }

      out += ch;
    }

    outLines.push(out);
  }

  return outLines.join("\n");
}
