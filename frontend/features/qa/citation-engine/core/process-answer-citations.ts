/**
 * 答案引用处理入口
 * 按顺序执行：规范化引用位置 → 转换为锚点 → 圆圈引用回退 → 剥离内联标签。
 * 所有阶段统一处理，保证"输出过程即结果"。
 */
import type { SourceInfo } from "../../types";
import { collectValidCitationLabels } from "./citation-utils";
import { convertCitationsToAnchors } from "./convert-citations-to-anchors";
import { convertCircledCitationsToAnchors } from "./convert-circled-citations-to-anchors";
import { normalizeCitations } from "./normalize-citations";
import { stripInlineCitationLabels } from "./strip-inline-citation-labels";

interface ProcessAnswerCitationsArgs {
  text: string;
  sources: SourceInfo[];
  isStreaming?: boolean;
}

function collectCitationLabelsFromText(text: string): Set<string> {
  const labels = new Set<string>();
  for (const match of text.matchAll(/\[(\d{1,2}-\d{1,2})\]/g)) {
    const label = (match[1] || "").trim();
    if (label) labels.add(label);
  }
  return labels;
}

/**
 * Keep answer-body citation processing in one place so renderers can stay thin.
 */
export function processAnswerCitations(args: ProcessAnswerCitationsArgs): string {
  const { text, sources } = args;
  if (!text) return text;

  // All phases use identical citation processing to guarantee
  // streaming output === final output (no structure jumping).
  const normalized = normalizeCitations(text, sources);
  const validLabels = collectValidCitationLabels(sources);
  const fallbackLabels = validLabels.size > 0
    ? validLabels
    : collectCitationLabelsFromText(normalized);
  const withAnchors = convertCitationsToAnchors(normalized, fallbackLabels);
  const withCircledFallback = convertCircledCitationsToAnchors(withAnchors, sources);

  return stripInlineCitationLabels(withCircledFallback);
}
