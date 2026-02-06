import type { ChatHistoryMessage, ChatResponse } from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_HDMS_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://localhost:8000";

const CHAT_ENDPOINT = `${API_BASE.replace(/\/$/, "")}/qa/chat`;

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