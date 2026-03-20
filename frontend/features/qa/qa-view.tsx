/**
 * 问答视图主组件
 * 管理消息列表、流式接收 SSE 事件（thinking/answer/sources/done），
 * 并将状态通过 QAShell 渲染为聊天界面。
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { QAConversationHistoryPanel } from "@/components/qa-new/qa-conversation-history-panel";
import { QAShell } from "@/components/qa-new";
import { cn } from "@/lib/utils";
import { useQAViewStore } from "@/lib/stores/qa-store";
import { sendQuestionStream } from "./api";
import type { ChatHistoryMessage, ChatMessage } from "./types";
import { mergeStreamingSources } from "@/lib/stream-source-utils";
import {
  initialAssistantRenderState,
  transitionAssistantRenderState,
} from "@/features/qa/render/assistant-render-state-machine";

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
  structuredImageMarkerCount: number;
  length: number;
};

function inspectMarkdownShape(markdown: string): MarkdownShapeMetrics {
  const text = String(markdown || "");
  const normalized = text.replace(/[｜丨│┃¦￨￤]/g, "|");
  const lines = text.split("\n");
  const normalizedLines = normalized.split("\n");
  let gfmTableBlocks = 0;
  let pipeHeavyLines = 0;

  for (let i = 0; i < normalizedLines.length; i++) {
    const line = normalizedLines[i] ?? "";
    const pipeCount = (line.match(/\|/g) || []).length;
    if (pipeCount >= 2) pipeHeavyLines += 1;

    const headerLike = /^\s*\|.+\|\s*$/.test(line.trim());
    const sepLike = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(
      (normalizedLines[i + 1] || "").trim(),
    );
    if (headerLike && sepLike) gfmTableBlocks += 1;
  }

  const markdownImageCount = (text.match(/!\[[^\]]*]\([^)]+\)/g) || []).length;
  const structuredImageMarkerCount = (
    text.match(/\[\[\s*IMG\s*:\s*\d{1,2}-\d{1,2}(?:#\d{1,2})?\s*\]\]/gi) || []
  ).length;

  return {
    gfmTableBlocks,
    pipeHeavyLines,
    markdownImageCount,
    structuredImageMarkerCount,
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

  // Reject when image-like anchors disappear completely after replacement.
  const curImageLike = cur.markdownImageCount + cur.structuredImageMarkerCount;
  const nextImageLike = next.markdownImageCount + next.structuredImageMarkerCount;
  if (curImageLike > 0 && nextImageLike === 0) return false;

  // Guard against accidental severe truncation.
  if (cur.length > 120 && next.length < cur.length * 0.55) return false;

  return true;
}

interface QAViewProps {
  embedded?: boolean;
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
}

export function QAView({
  embedded = false,
  historyOpen = false,
  onHistoryOpenChange,
}: QAViewProps = {}) {
  const conversations = useQAViewStore((state) => state.conversations);
  const activeConversationId = useQAViewStore((state) => state.activeConversationId);
  const createConversation = useQAViewStore((state) => state.createConversation);
  const switchConversation = useQAViewStore((state) => state.switchConversation);
  const renameConversation = useQAViewStore((state) => state.renameConversation);
  const deleteConversation = useQAViewStore((state) => state.deleteConversation);
  const togglePinConversation = useQAViewStore((state) => state.togglePinConversation);
  const messages = useQAViewStore((state) => state.messages);
  const appendMessage = useQAViewStore((state) => state.appendMessage);
  const updateMessage = useQAViewStore((state) => state.updateMessage);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  void onHistoryOpenChange;

  const handleCreateConversation = useCallback(() => {
    if (isSending) return;
    createConversation();
    setInput("");
  }, [createConversation, isSending]);

  const handleSwitchConversation = useCallback((id: string) => {
    if (isSending) return;
    switchConversation(id);
    setInput("");
  }, [isSending, switchConversation]);

  const handleRenameConversation = useCallback((id: string, title: string) => {
    renameConversation(id, title);
  }, [renameConversation]);

  const handleDeleteConversation = useCallback((id: string) => {
    if (isSending) return;
    deleteConversation(id);
    setInput("");
  }, [deleteConversation, isSending]);

  const handleTogglePinConversation = useCallback((id: string) => {
    if (isSending) return;
    togglePinConversation(id);
  }, [isSending, togglePinConversation]);

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
      renderState: initialAssistantRenderState(),
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
          updateMessage(assistantId, (msg) => ({
            ...msg,
            statusStage: stage,
            statusMessage: message,
            renderState: transitionAssistantRenderState(msg.renderState, { type: "status", stage }),
          }));
        },
        onThinking: (token) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            thinking: (msg.thinking || "") + token,
            thinkingDone: false,
            renderState: transitionAssistantRenderState(msg.renderState, { type: "thinking" }),
          }));
        },
        onThinkingDone: () => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            thinkingDone: true,
            renderState: transitionAssistantRenderState(msg.renderState, { type: "thinking_done" }),
          }));
        },
        onAnswer: (token) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            // Keep answer hidden only when there is real, unfinished thinking text.
            // If the model streams answer directly (no thinking_done event), we should
            // still enter answering state to avoid "nothing shows until done".
            renderState: transitionAssistantRenderState(msg.renderState, {
              type: "answer",
              holdDuringReasoning: Boolean((msg.thinking || "").trim()) && !msg.thinkingDone,
            }),
            content: msg.content + token,
          }));
        },
        onAnswerReplaced: (fullAnswer, replacedSources) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            content: shouldAcceptAnswerReplacement(msg.content, fullAnswer)
              ? fullAnswer
              : msg.content,
            // Keep streaming UI state until `done` so finalizing and done share
            // one stable final-content pipeline instead of two style jumps.
            isStreaming: true,
            finalizedByServer: true,
            renderState: transitionAssistantRenderState(msg.renderState, { type: "answer_replaced" }),
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
            renderState: transitionAssistantRenderState(msg.renderState, { type: "done" }),
          }));
        },
        onError: (detail) => {
          updateMessage(assistantId, (msg) => ({
            ...msg,
            content: msg.content || `Error: ${detail}`,
            isStreaming: false,
            statusStage: undefined,
            statusMessage: undefined,
            renderState: transitionAssistantRenderState(msg.renderState, { type: "error" }),
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
          renderState: transitionAssistantRenderState(msg.renderState, { type: "done" }),
        }));
        return;
      }

      // SSE stream failed (non-abort)
      const detail =
        error instanceof Error ? error.message : "请求失败";
      updateMessage(assistantId, (msg) => ({
        ...msg,
        content: msg.content || `请求失败：${detail}`,
        isStreaming: false,
        renderState: transitionAssistantRenderState(msg.renderState, { type: "error" }),
      }));
    } finally {
      if (activeAbortControllerRef.current === streamAbortController) {
        activeAbortControllerRef.current = null;
      }
      setIsSending(false);
    }
  };

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden bg-background">
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
        </div>

        <div
          className={cn(
            "min-h-0 shrink-0 overflow-hidden border-l border-border bg-card transition-[width] duration-300 ease-out",
            historyOpen ? "w-[280px]" : "w-0 border-l-transparent"
          )}
        >
          <QAConversationHistoryPanel
            conversations={conversations}
            activeConversationId={activeConversationId}
            disabled={isSending}
            historyOpen={historyOpen}
            onCreateConversation={handleCreateConversation}
            onSwitchConversation={handleSwitchConversation}
            onRenameConversation={handleRenameConversation}
            onDeleteConversation={handleDeleteConversation}
            onTogglePinConversation={handleTogglePinConversation}
          />
        </div>
      </div>
    );
  }

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
