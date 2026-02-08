import type { ChatHistoryMessage, ChatResponse } from "./types";
import { QA_API_BASE, normalizeApiBase } from "@/lib/api-base";
import { streamChat, type SSECallbacks } from "@/lib/sse-client";

const CHAT_ENDPOINT = `${normalizeApiBase(QA_API_BASE)}/qa/chat`;

export async function sendQuestion(
  question: string,
  history: ChatHistoryMessage[]
): Promise<ChatResponse> {
  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, history }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `请求失败: ${response.status}`);
  }

  return (await response.json()) as ChatResponse;
}

export async function sendQuestionStream(
  question: string,
  history: ChatHistoryMessage[],
  callbacks: SSECallbacks,
  signal?: AbortSignal,
): Promise<void> {
  return streamChat(question, history, callbacks, signal);
}

export interface FeedbackPayload {
  message_id: string;
  question: string;
  answer: string;
  rating: "useful" | "not_useful";
  comment?: string;
}

export async function submitFeedback(
  payload: FeedbackPayload,
): Promise<{ success: boolean; feedback_id: string }> {
  const response = await fetch("/qa/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Feedback failed: ${response.status}`);
  }

  return response.json();
}
