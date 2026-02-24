import type { AnswerRenderPhase } from "@/features/qa/render/assistant-render-state-machine";
import { normalizeAnswerMarkdownArtifacts } from "@/lib/normalize-answer-markdown-artifacts";

export interface NormalizeAnswerMarkdownByPhaseArgs {
  content: string;
  renderPhase: AnswerRenderPhase;
}

/**
 * Phase-aware markdown normalization:
 * - streaming/finalizing: light mode (stability first, avoid aggressive rewrites)
 * - final: full mode (completeness/readability cleanup)
 */
export function normalizeAnswerMarkdownByPhase(
  args: NormalizeAnswerMarkdownByPhaseArgs,
): string {
  const { content, renderPhase } = args;
  if (!content) return content;

  const lightMode = renderPhase === "streaming" || renderPhase === "finalizing";
  return normalizeAnswerMarkdownArtifacts(content, {
    streaming: lightMode,
  });
}
