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
  const { markdown, sources, precedingQuestion, renderPhase } = args;
  if (!markdown) return markdown;

  switch (renderPhase) {
    case "streaming":
      // Keep streaming conservative: prioritize structured anchors and direct refs,
      // avoid placeholder rewrites/appendix fallback to reduce jitter.
      return injectSourceImages(markdown, sources, precedingQuestion, {
        streaming: true,
        allowPlaceholderReplacement: false,
        allowAppendixFallback: false,
      });
    case "finalizing":
      // Stabilize finalizing output with full line-level matching, but still
      // postpone appendix fallback until done to avoid late streaming jumps.
      return injectSourceImages(markdown, sources, precedingQuestion, {
        streaming: false,
        allowPlaceholderReplacement: false,
        allowAppendixFallback: false,
      });
    case "final":
    default:
      return injectSourceImages(markdown, sources, precedingQuestion, {
        streaming: false,
        allowPlaceholderReplacement: true,
        allowAppendixFallback: true,
      });
  }
}
