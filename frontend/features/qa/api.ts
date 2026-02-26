import type { ChatHistoryMessage } from "./types";
import { streamChat, type SSECallbacks } from "@/lib/sse-client";

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
