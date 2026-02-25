import type { SourceInfo } from "../../types";
import { collectValidCitationLabels } from "./citation-utils";
import { sanitizeAnswerCitations } from "./sanitize-answer-citations";

/**
 * Post-process answer text to normalize citation placement.
 * 1) Move citations before punctuation: "内容。[1-1]" -> "内容[1-1]。"
 * 2) Strip citations inside markdown table rows
 * 3) Remove invalid/duplicate citation labels
 */
export function normalizeCitations(text: string, sources: SourceInfo[]): string {
  if (!text) return text;

  let result = text;
  const validLabels = collectValidCitationLabels(sources);

  result = result.replace(
    /([。！？.!?])(\s*(?:\[\d{1,2}-\d{1,2}\])+)/g,
    (_, punct, cites) => `${cites.trim()}${punct}`,
  );

  result = result.replace(
    /^(\|.+)$/gm,
    (line) => line.replace(/\[\d{1,2}-\d{1,2}\]/g, ""),
  );

  result = sanitizeAnswerCitations({ text: result, validLabels });
  return result;
}
