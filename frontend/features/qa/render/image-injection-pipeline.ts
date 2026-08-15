/**
 * 图片注入管线（统一策略）
 * 所有阶段使用相同的注入逻辑，保证"输出过程即结果"。
 * 不使用占位符替换；允许强图片意图问题追加少量相关配图。
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

function normalizeImageIntentQuery(query?: string): string | undefined {
  const text = String(query || "").trim();
  if (!text) return query;
  if (/(配图|附图|见图|如图|下图|流程图|示意图|剖面图|平面图|控制图)/u.test(text)) {
    return text;
  }
  if (/(图片|图像|插图|图纸|图表|图示)/u.test(text)) {
    return `${text} 配图`;
  }
  return text;
}

export function injectAnswerImagesByPhase(args: InjectAnswerImagesArgs): string {
  const { markdown, sources, precedingQuestion } = args;
  if (!markdown) return markdown;

  // All phases use identical strategy: full line-level matching, no placeholder replacement.
  // Appendix fallback is still guarded by image intent inside injectSourceImages.
  return injectSourceImages(markdown, sources, normalizeImageIntentQuery(precedingQuestion), {
    streaming: false,
    allowPlaceholderReplacement: false,
    allowAppendixFallback: true,
  });
}
