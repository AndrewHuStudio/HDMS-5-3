/**
 * 引用位置规范化
 * 1) 将标点后的引用移到标点前：内容。[1-1] → 内容[1-1]。
 * 2) 剥除 Markdown 表格行内的引用标签
 * 3) 移除无效/重复的引用标签
 */
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

  if (validLabels.size > 0) {
    result = sanitizeAnswerCitations({ text: result, validLabels });
  }
  return result;
}
