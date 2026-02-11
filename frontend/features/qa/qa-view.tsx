"use client";

import { useState } from "react";
import { QAShell } from "@/components/qa-new";
import { useQAViewStore } from "@/lib/stores/qa-store";
import { sendQuestion, sendQuestionStream } from "./api";
import type { ChatHistoryMessage, ChatMessage } from "./types";

const quickQuestions = [
  "高强度片区的核心管控指标有哪些",
  "请总结课题知识库中的主要结论",
  "DU01-01地块的容积率与限高要求是什么",
  "城市设计管控方案评估的关键依据有哪些",
];

const createMessage = (
  role: ChatMessage["role"],
  content: string,
  extra?: Partial<ChatMessage>,
): ChatMessage => ({
  id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role,
  content,
  createdAt: new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }),
  ...extra,
});

const buildHistory = (messages: ChatMessage[]): ChatHistoryMessage[] => {
  return messages
    .filter((message) => message.id !== "welcome")
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.content }));
};

export function QAView() {
  const messages = useQAViewStore((state) => state.messages);
  const appendMessage = useQAViewStore((state) => state.appendMessage);
  const updateMessage = useQAViewStore((state) => state.updateMessage);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleFeedback = (messageId: string, feedback: "useful" | "not_useful") => {
    updateMessage(messageId, (msg) => ({ ...msg, feedback }));
  };

  const handleSend = async (presetQuestion?: string) => {
    const question = (presetQuestion ?? input).trim();
    if (!question || isSending) return;

    const history = buildHistory(messages);
    const userMessage = createMessage("user", question);
    appendMessage(userMessage);
    setInput("");
    setIsSending(true);

    // Create placeholder assistant message for streaming
    const assistantMsg = createMessage("assistant", "", {
      thinking: "",
      sources: [],
      isStreaming: true,
    });
    const assistantId = assistantMsg.id;
    appendMessage(assistantMsg);

    try {
      await sendQuestionStream(question, history, {
        onSources: (sources) => {
          updateMessage(assistantId, (msg) => ({ ...msg, sources }));
        },
        onRetrievalStats: (stats) => {
          updateMessage(assistantId, (msg) => ({ ...msg, retrievalStats: stats }));
        },
        onGraph: (subgraph) => {
          updateMessage(assistantId, (msg) => ({ ...msg, subgraph }));
        },
        onStatus: () => undefined,
        onThinking: (token) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            thinking: (msg.thinking || "") + token,
          }));
        },
        onAnswer: (token) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            content: msg.content + token,
          }));
        },
        onDone: () => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            isStreaming: false,
            statusMessage: undefined,
          }));
        },
        onError: (detail) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            content: msg.content || `Error: ${detail}`,
            isStreaming: false,
            statusMessage: undefined,
          }));
        },
      });
    } catch {
      // Fallback to non-streaming if SSE fails
      try {
        const response = await sendQuestion(question, history);
        updateMessage(assistantId, (msg) => ({
          ...msg,
          content: response.answer || "未返回答案。",
          sources: response.sources,
          isStreaming: false,
        }));
      } catch (fallbackError) {
        const detail =
          fallbackError instanceof Error ? fallbackError.message : "请求失败";
        updateMessage(assistantId, (msg) => ({
          ...msg,
          content: msg.content || `请求失败：${detail}`,
          isStreaming: false,
        }));
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <QAShell
      messages={messages}
      input={input}
      isSending={isSending}
      quickQuestions={quickQuestions}
      onInputChange={setInput}
      onSend={handleSend}
      onFeedback={handleFeedback}
    />
  );
}
