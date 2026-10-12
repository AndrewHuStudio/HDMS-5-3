/**
 * 助手消息渲染状态机
 * 定义 understanding → retrieving → answering → finalizing → done/error 的状态流转。
 * transitionAssistantRenderState: 根据 SSE 事件推进状态（只允许前进，不回退）。
 * buildAssistantRenderModel: 根据当前状态决定各 UI 区块的显示策略。
 */
import type { AssistantRenderState, ChatMessage } from "@/features/qa/types";

export type AssistantRenderEvent =
  | { type: "status"; stage?: string }
  | { type: "answer" }
  | { type: "answer_replaced" }
  | { type: "done" }
  | { type: "error" };

const STATE_RANK: Record<AssistantRenderState, number> = {
  understanding: 1,
  retrieving: 2,
  answering: 3,
  finalizing: 4,
  done: 5,
  error: 6,
};

function preferForwardState(
  current: AssistantRenderState,
  next: AssistantRenderState,
): AssistantRenderState {
  return STATE_RANK[next] >= STATE_RANK[current] ? next : current;
}

function normalizeStatusStage(stage?: string): AssistantRenderState {
  const normalized = String(stage || "").trim().toLowerCase();
  if (normalized === "retrieving") return "retrieving";
  if (normalized === "generating") return "answering";
  return "understanding";
}

export function initialAssistantRenderState(): AssistantRenderState {
  return "understanding";
}

export function transitionAssistantRenderState(
  currentState: AssistantRenderState | undefined,
  event: AssistantRenderEvent,
): AssistantRenderState {
  const current = currentState || initialAssistantRenderState();

  switch (event.type) {
    case "status":
      return preferForwardState(current, normalizeStatusStage(event.stage));
    case "answer":
      return preferForwardState(current, "answering");
    case "answer_replaced":
      return preferForwardState(current, "finalizing");
    case "done":
      return "done";
    case "error":
      return "error";
    default:
      return current;
  }
}

export function deriveAssistantRenderState(message: ChatMessage): AssistantRenderState {
  if (message.renderState) return message.renderState;

  const stage = normalizeStatusStage(message.statusStage);
  if ((message.content || "").trim()) {
    return message.isStreaming ? "answering" : "done";
  }
  if (message.isStreaming) return stage;
  return "done";
}

export interface AssistantRenderModelInput {
  state: AssistantRenderState;
  isStreaming: boolean;
  hasAnswer: boolean;
  hasRetrievalStats: boolean;
}

export interface AssistantRenderModel {
  showRetrievalStats: boolean;
  showAnswer: boolean;
  showStreamingCursor: boolean;
}

export type AnswerRenderPhase = "streaming" | "finalizing" | "final";

export interface ResolveAnswerRenderPhaseInput {
  state: AssistantRenderState;
  isStreaming: boolean;
}

export function resolveAnswerRenderPhase(
  input: ResolveAnswerRenderPhaseInput,
): AnswerRenderPhase {
  if (input.state === "finalizing") return "finalizing";
  if (!input.isStreaming || input.state === "done" || input.state === "error") {
    return "final";
  }
  return "streaming";
}

export function buildAssistantRenderModel(
  input: AssistantRenderModelInput,
): AssistantRenderModel {
  const showRetrievalStats = input.hasRetrievalStats && (
    !input.isStreaming || STATE_RANK[input.state] >= STATE_RANK.retrieving
  );

  const showAnswer = input.hasAnswer || (
    !input.isStreaming && STATE_RANK[input.state] >= STATE_RANK.answering
  );

  return {
    showRetrievalStats,
    showAnswer,
    showStreamingCursor: Boolean(input.isStreaming && showAnswer),
  };
}
