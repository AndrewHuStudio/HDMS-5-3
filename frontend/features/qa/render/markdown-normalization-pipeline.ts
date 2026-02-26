import type { AnswerRenderPhase } from "@/features/qa/render/assistant-render-state-machine";
import { runNormalizationPipeline } from "@/lib/normalize-rules";
import type { NormalizePhase } from "@/lib/normalize-rules/types";

export interface NormalizeAnswerMarkdownByPhaseArgs {
  content: string;
  renderPhase: AnswerRenderPhase;
}

/** Map the render-layer phase to the normalize-rules phase (1:1 now). */
function toNormalizePhase(renderPhase: AnswerRenderPhase): NormalizePhase {
  return renderPhase; // "streaming" | "finalizing" | "final"
}

/**
 * Phase-aware markdown normalization:
 * - streaming:   lightweight safety rules only
 * - finalizing:  medium-weight rewrite rules (heading/list normalization)
 * - final:       full rule set (scaffold, promotion, conclusion)
 */
export function normalizeAnswerMarkdownByPhase(
  args: NormalizeAnswerMarkdownByPhaseArgs,
): string {
  const { content, renderPhase } = args;
  if (!content) return content;

  return runNormalizationPipeline(content, {
    phase: toNormalizePhase(renderPhase),
  });
}
