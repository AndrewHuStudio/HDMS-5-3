import { buildAnswerMarkdown } from "@/features/qa/render/answer-markdown-pipeline";
import {
  initialAssistantRenderState,
  resolveAnswerRenderPhase,
} from "@/features/qa/render/assistant-render-state-machine";
import type {
  AssistantRenderState,
  SourceInfo,
} from "@/features/qa/types";
import type { AnswerRenderPhase } from "@/features/qa/render/assistant-render-state-machine";

export interface ResolveAssistantAnswerMarkdownArgs {
  content: string;
  stableMarkdown?: string;
  sources: SourceInfo[];
  isStreaming: boolean;
  renderPhase: AnswerRenderPhase;
  precedingQuestion?: string;
  finalizedByServer?: boolean;
}

export interface CaptureVisibleAnswerMarkdownArgs {
  content: string;
  sources: SourceInfo[];
  isStreaming: boolean;
  renderState?: AssistantRenderState;
  precedingQuestion?: string;
  finalizedByServer?: boolean;
}

export function resolveAssistantAnswerMarkdown(
  args: ResolveAssistantAnswerMarkdownArgs,
): string {
  const {
    content,
    stableMarkdown,
    sources,
    isStreaming,
    renderPhase,
    precedingQuestion,
    finalizedByServer,
  } = args;

  if (stableMarkdown && !isStreaming) {
    return stableMarkdown;
  }

  return buildAnswerMarkdown({
    content,
    sources,
    isStreaming,
    renderPhase,
    precedingQuestion,
    finalizedByServer,
  });
}

export function captureVisibleAnswerMarkdown(
  args: CaptureVisibleAnswerMarkdownArgs,
): string {
  const {
    content,
    sources,
    isStreaming,
    renderState,
    precedingQuestion,
    finalizedByServer,
  } = args;

  const renderPhase = resolveAnswerRenderPhase({
    state: renderState || initialAssistantRenderState(),
    isStreaming,
  });

  return buildAnswerMarkdown({
    content,
    sources,
    isStreaming,
    renderPhase,
    precedingQuestion,
    finalizedByServer,
  });
}
