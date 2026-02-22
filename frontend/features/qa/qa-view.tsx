"use client";

import { useCallback, useRef, useState } from "react";
import { QAShell } from "@/components/qa-new";
import { useQAViewStore } from "@/lib/stores/qa-store";
import { sendQuestion, sendQuestionStream } from "./api";
import type { ChatHistoryMessage, ChatMessage } from "./types";
import { mergeStreamingSources } from "@/lib/stream-source-utils";

const quickQuestions: string[] = [];

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

type MarkdownShapeMetrics = {
  gfmTableBlocks: number;
  pipeHeavyLines: number;
  markdownImageCount: number;
  length: number;
};

function inspectMarkdownShape(markdown: string): MarkdownShapeMetrics {
  const text = String(markdown || "");
  const lines = text.split("\n");
  let gfmTableBlocks = 0;
  let pipeHeavyLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const pipeCount = (line.match(/\|/g) || []).length;
    if (pipeCount >= 2) pipeHeavyLines += 1;

    const headerLike = /^\s*\|.+\|\s*$/.test(line.trim());
    const sepLike = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(
      (lines[i + 1] || "").trim(),
    );
    if (headerLike && sepLike) gfmTableBlocks += 1;
  }

  const markdownImageCount = (text.match(/!\[[^\]]*]\([^)]+\)/g) || []).length;

  return {
    gfmTableBlocks,
    pipeHeavyLines,
    markdownImageCount,
    length: text.trim().length,
  };
}

function shouldAcceptAnswerReplacement(current: string, replacement: string): boolean {
  const currentText = String(current || "");
  const nextText = String(replacement || "");
  if (!nextText.trim()) return false;
  if (!currentText.trim()) return true;

  const cur = inspectMarkdownShape(currentText);
  const next = inspectMarkdownShape(nextText);

  // Reject obvious degradation: valid table block disappears and turns into raw pipe lines.
  const tableDowngradedToPipes =
    cur.gfmTableBlocks > 0 &&
    next.gfmTableBlocks === 0 &&
    next.pipeHeavyLines >= Math.max(2, cur.pipeHeavyLines);
  if (tableDowngradedToPipes) return false;

  // Reject when images disappear completely after replacement.
  if (cur.markdownImageCount > 0 && next.markdownImageCount === 0) return false;

  // Guard against accidental severe truncation.
  if (cur.length > 120 && next.length < cur.length * 0.55) return false;

  return true;
}

interface QAViewProps {
  embedded?: boolean;
}

export function QAView({ embedded = false }: QAViewProps = {}) {
  const messages = useQAViewStore((state) => state.messages);
  const appendMessage = useQAViewStore((state) => state.appendMessage);
  const updateMessage = useQAViewStore((state) => state.updateMessage);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const handleFeedback = (messageId: string, feedback: "useful" | "not_useful") => {
    updateMessage(messageId, (msg) => ({ ...msg, feedback }));
  };

  const handleStop = useCallback(() => {
    activeAbortControllerRef.current?.abort();
  }, []);

  const handleSend = async (presetQuestion?: string) => {
    const question = (presetQuestion ?? input).trim();
    if (!question || isSending) return;

    const history = buildHistory(messages);
    const userMessage = createMessage("user", question);
    appendMessage(userMessage);
    setInput("");
    setIsSending(true);
    const streamAbortController = new AbortController();
    activeAbortControllerRef.current = streamAbortController;

    // Create placeholder assistant message for streaming
    const assistantMsg = createMessage("assistant", "", {
      thinking: "",
      sources: [],
      isStreaming: true,
      statusStage: "understanding",
      statusMessage: "正在理解你的问题...",
    });
    const assistantId = assistantMsg.id;
    appendMessage(assistantMsg);

    try {
      await sendQuestionStream(question, history, {
        onSources: (sources) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            sources: mergeStreamingSources(msg.sources, sources),
          }));
        },
        onRetrievalStats: (stats) => {
          updateMessage(assistantId, (msg) => ({ ...msg, retrievalStats: stats }));
        },
        onGraph: (subgraph) => {
          updateMessage(assistantId, (msg) => ({ ...msg, subgraph }));
        },
        onStatus: (stage, message) => {
          updateMessage(assistantId, (msg) => ({ ...msg, statusStage: stage, statusMessage: message }));
        },
        onThinking: (token) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            thinking: (msg.thinking || "") + token,
            thinkingDone: false,
          }));
        },
        onThinkingDone: () => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            thinkingDone: true,
          }));
        },
        onAnswer: (token) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            content: msg.content + token,
          }));
        },
        onAnswerReplaced: (fullAnswer, replacedSources) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            content: shouldAcceptAnswerReplacement(msg.content, fullAnswer)
              ? fullAnswer
              : msg.content,
            isStreaming: false,
            finalizedByServer: true,
            ...(replacedSources
              ? { sources: mergeStreamingSources(msg.sources, replacedSources) }
              : {}),
          }));
        },
        onDone: () => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            isStreaming: false,
            statusStage: undefined,
            statusMessage: undefined,
          }));
        },
        onError: (detail) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            content: msg.content || `Error: ${detail}`,
            isStreaming: false,
            statusStage: undefined,
            statusMessage: undefined,
          }));
        },
      }, streamAbortController.signal);
    } catch (error) {
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError");
      if (aborted) {
        updateMessage(assistantId, (msg) => ({
          ...msg,
          isStreaming: false,
          thinkingDone: true,
          statusStage: undefined,
          statusMessage: undefined,
        }));
        return;
      }

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
      if (activeAbortControllerRef.current === streamAbortController) {
        activeAbortControllerRef.current = null;
      }
      setIsSending(false);
    }
  };

  return (
    <QAShell
      embedded={embedded}
      messages={messages}
      input={input}
      isSending={isSending}
      quickQuestions={quickQuestions}
      onInputChange={setInput}
      onSend={handleSend}
      onStop={handleStop}
      onFeedback={handleFeedback}
    />
  );
}
