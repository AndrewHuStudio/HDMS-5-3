"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { ThinkingProcess } from "@/components/qa-thinking";
import { QASources } from "@/components/qa-sources";
import { QARetrievalStats } from "@/components/qa-retrieval-stats";
import { QAFeedback } from "@/components/qa-feedback";
import { QAExportButton } from "@/components/qa-export-button";
import type { ChatMessage } from "@/features/qa/types";

interface QAShellProps {
  title?: string;
  subtitle?: string;
  messages: ChatMessage[];
  input: string;
  isSending?: boolean;
  quickQuestions?: string[];
  onInputChange: (value: string) => void;
  onSend: (question?: string) => void;
  onFeedback?: (messageId: string, feedback: "useful" | "not_useful") => void;
}

export function QAShell({
  title = "HDMS 问答",
  subtitle = "基于上传资料的智能问答",
  messages,
  input,
  isSending = false,
  quickQuestions = [],
  onInputChange,
  onSend,
  onFeedback,
}: QAShellProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isSending]);

  const canSend = !isSending && input.trim().length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <QAExportButton messages={messages} disabled={isSending} />
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((message, idx) => {
            let precedingQuestion: string | undefined;
            if (message.role === "assistant") {
              for (let i = idx - 1; i >= 0; i--) {
                if (messages[i].role === "user") {
                  precedingQuestion = messages[i].content;
                  break;
                }
              }
            }

            return (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {message.role === "assistant" ? (
                    <AssistantContent
                      message={message}
                      precedingQuestion={precedingQuestion}
                      onFeedback={onFeedback}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                  <p
                    className={`mt-1 text-[11px] ${
                      message.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    {message.createdAt}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {quickQuestions.length > 0 && (
        <div className="border-t border-border bg-card px-6 py-3">
          <div className="flex flex-wrap gap-2">
            {quickQuestions.map((question) => (
              <Button
                key={question}
                variant="secondary"
                size="sm"
                className="text-xs"
                onClick={() => onSend(question)}
                disabled={isSending}
              >
                {question}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border bg-card px-6 py-4">
        <div className="flex gap-3">
          <Textarea
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题，按 Enter 发送，Shift+Enter 换行"
            className="min-h-[56px] resize-none"
          />
          <Button
            onClick={() => onSend()}
            disabled={!canSend}
            className="h-[56px] px-4"
          >
            <Send className="mr-2 h-4 w-4" />
            {isSending ? "发送中" : "发送"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Renders assistant message with thinking, retrieval stats, markdown, citations, sources, and feedback. */
function AssistantContent({
  message,
  precedingQuestion,
  onFeedback,
}: {
  message: ChatMessage;
  precedingQuestion?: string;
  onFeedback?: (messageId: string, feedback: "useful" | "not_useful") => void;
}) {
  const { content, thinking, sources, retrievalStats, feedback, isStreaming } = message;

  return (
    <div>
      {/* Thinking process (collapsible) */}
      {thinking && (
        <ThinkingProcess thinking={thinking} isStreaming={!!isStreaming} />
      )}

      {/* Retrieval stats (collapsible) */}
      {retrievalStats && (
        <QARetrievalStats stats={retrievalStats} isStreaming={!!isStreaming} />
      )}

      {/* Main answer with markdown */}
      {content ? (
        <div className="qa-markdown prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
              ol: ({ children }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
              li: ({ children }) => <li className="mb-1 last:mb-0">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              code: ({ children, className }) => {
                const isBlock = className?.includes("language-");
                return isBlock ? (
                  <code className={`${className ?? ""} block overflow-x-auto rounded bg-muted p-2 text-xs`}>
                    {children}
                  </code>
                ) : (
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
                );
              },
              pre: ({ children }) => <pre className="mb-2 overflow-x-auto">{children}</pre>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-border pl-3 italic text-muted-foreground">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="mb-2 overflow-x-auto">
                  <table className="min-w-full border-collapse text-xs">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-border px-2 py-1">{children}</td>
              ),
              // Render citation links [1] as clickable anchors
              a: ({ href, children }) => {
                // Check if it's a citation anchor like #source-1
                if (href?.startsWith("#source-")) {
                  return (
                    <a
                      href={href}
                      className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded bg-primary/10 px-0.5 text-[10px] font-semibold text-primary no-underline hover:bg-primary/20"
                      onClick={(e) => {
                        e.preventDefault();
                        const el = document.getElementById(href.slice(1));
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                    >
                      {children}
                    </a>
                  );
                }
                return <a href={href} className="text-primary underline">{children}</a>;
              },
            }}
          >
            {content}
          </ReactMarkdown>
          {/* Streaming cursor */}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
          )}
        </div>
      ) : isStreaming ? (
        <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground" />
      ) : null}

      {/* Source citations */}
      {sources && sources.length > 0 && !isStreaming && (
        <QASources sources={sources} query={precedingQuestion} />
      )}

      {/* Feedback buttons */}
      {content && !isStreaming && onFeedback && precedingQuestion && (
        <QAFeedback
          messageId={message.id}
          question={precedingQuestion}
          answer={content}
          currentFeedback={feedback}
          onFeedbackChange={(fb) => onFeedback(message.id, fb)}
        />
      )}
    </div>
  );
}
