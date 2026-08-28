import {
  transitionAssistantRenderState,
} from "@/features/qa/render/assistant-render-state-machine";
import { captureVisibleAnswerMarkdown } from "@/features/qa/render/resolve-answer-markdown";
import type { ChatMessage, SourceInfo } from "@/features/qa/types";
import { mergeStreamingSources } from "@/lib/stream-source-utils";

export interface StageServerAnswerReplacementArgs {
  message: ChatMessage;
  fullAnswer: string;
  replacedSources?: SourceInfo[];
  accepted: boolean;
}

export function stageServerAnswerReplacement(
  args: StageServerAnswerReplacementArgs,
): ChatMessage {
  const { message, fullAnswer, replacedSources, accepted } = args;
  if (!accepted) return message;

  return {
    ...message,
    pendingFinalContent: fullAnswer,
    pendingFinalSources: replacedSources
      ? mergeStreamingSources(message.sources, replacedSources)
      : message.sources,
    finalizedByServer: true,
  };
}

export interface FinalizeStreamingAssistantMessageArgs {
  message: ChatMessage;
  precedingQuestion?: string;
}

export function finalizeStreamingAssistantMessage(
  args: FinalizeStreamingAssistantMessageArgs,
): ChatMessage {
  const { message, precedingQuestion } = args;
  const finalContent = message.pendingFinalContent || message.content;
  const finalSources = message.pendingFinalSources || message.sources || [];
  const stableMarkdown =
    message.stableMarkdown ||
    captureVisibleAnswerMarkdown({
      content: finalContent,
      sources: finalSources,
      // This is the done branch — the message stops streaming here (see the
      // returned isStreaming: false).  Baking the final frame as "streaming"
      // would permanently skip the final-only image fallbacks.
      isStreaming: false,
      renderState: message.renderState,
      precedingQuestion,
      finalizedByServer: message.finalizedByServer,
    });

  return {
    ...message,
    content: finalContent,
    sources: finalSources,
    stableMarkdown,
    isStreaming: false,
    statusStage: undefined,
    statusMessage: undefined,
    renderState: transitionAssistantRenderState(message.renderState, { type: "done" }),
    pendingFinalContent: undefined,
    pendingFinalSources: undefined,
  };
}
