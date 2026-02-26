/**
 * Markdown 规范化管线（阶段感知）
 * streaming:  仅执行轻量安全规则，避免流式抖动
 * finalizing: 中等权重重写（标题/列表规范化）
 * final:      完整规则集（脚手架、晋升、结论）
 */
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
