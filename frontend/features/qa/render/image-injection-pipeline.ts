/**
 * 图片注入管线（统一策略）
 * 所有阶段使用相同的注入逻辑，保证"输出过程即结果"。
 * 不使用占位符替换和附录回退，仅处理显式引用的图片。
 */
import type { AnswerRenderPhase } from "@/features/qa/render/assistant-render-state-machine";
import type { SourceInfo } from "@/features/qa/types";
import { injectSourceImages } from "@/lib/inject-source-images";

export interface InjectAnswerImagesArgs {
  markdown: string;
  sources: SourceInfo[];
  precedingQuestion?: string;
  renderPhase: AnswerRenderPhase;
}

export function injectAnswerImagesByPhase(args: InjectAnswerImagesArgs): string {
  const { markdown, sources, precedingQuestion } = args;
  if (!markdown) return markdown;

  // All phases use identical strategy: full line-level matching,
  // no placeholder replacement, no appendix fallback.
  // This guarantees streaming output === final output.
  return injectSourceImages(markdown, sources, precedingQuestion, {
    streaming: false,
    allowPlaceholderReplacement: false,
    allowAppendixFallback: false,
  });
}
