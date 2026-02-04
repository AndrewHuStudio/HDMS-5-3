"use client";

import { useState } from "react";
import { QAShell } from "@/components/qa-new";
import { sendQuestion } from "./api";
import type { ChatHistoryMessage, ChatMessage } from "./types";

const quickQuestions = [
  "城市管控要素有哪些",
  "限高控制有什么要求",
  "容积率如何影响开发强度",
  "如何展示管控要素关系",
];

const welcomeMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "你好，我是 HDMS 问答助手。你可以提问管控要素、指标解释或上传资料中的具体问题。",
  createdAt: new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }),
};

const createMessage = (role: ChatMessage["role"], content: string): ChatMessage => ({
  id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role,
  content,
  createdAt: new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }),
});

const buildHistory = (messages: ChatMessage[]): ChatHistoryMessage[] => {
  return messages
    .filter((message) => message.id !== "welcome")
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.content }));
};

export function QAView() {
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSend = async (presetQuestion?: string) => {
    const question = (presetQuestion ?? input).trim();
    if (!question || isSending) return;

    const history = buildHistory(messages);
    const userMessage = createMessage("user", question);
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const response = await sendQuestion(question, history);
      const answer = response.answer || "未返回答案。";
      const assistantMessage = createMessage("assistant", answer);
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "请求失败";
      const assistantMessage = createMessage("assistant", `请求失败：${detail}`);
      setMessages((prev) => [...prev, assistantMessage]);
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
    />
  );
}