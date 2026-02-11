"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
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
import { KnowledgeGraph } from "@/components/knowledge-graph";
import type { ChatMessage, SourceInfo } from "@/features/qa/types";
import { cn } from "@/lib/utils";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";

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

/** Lightweight image lightbox state */
function useImageLightbox() {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const open = useCallback((src: string) => setLightboxSrc(src), []);
  const close = useCallback(() => setLightboxSrc(null), []);
  return { lightboxSrc, open, close };
}

const CITATION_PATTERN = /\[(\d{1,2})\](?!\()/g;

function injectCitationAnchors(content: string, sourceCount: number): string {
  if (!content || sourceCount <= 0) return content;

  return content.replace(CITATION_PATTERN, (raw, value) => {
    const index = Number.parseInt(value, 10);
    if (Number.isNaN(index) || index < 1 || index > sourceCount) {
      return raw;
    }
    return `[${index}](#source-${index})`;
  });
}

function parseCitationIndex(href?: string): number | null {
  if (!href) return null;
  const match = href.match(/^#source-(\d+)$/);
  if (!match) return null;
  const index = Number.parseInt(match[1], 10);
  return Number.isNaN(index) ? null : index;
}

/** Extract recommended questions from <!--RECOMMENDED_QUESTIONS ... --> block */
function extractRecommendedQuestions(content: string): {
  cleanContent: string;
  questions: string[];
} {
  const pattern = /<!--RECOMMENDED_QUESTIONS\s*\n([\s\S]*?)-->/;
  const match = content.match(pattern);
  if (!match) return { cleanContent: content, questions: [] };

  const questions = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const cleanContent = content.replace(pattern, "").trimEnd();
  return { cleanContent, questions };
}

/** Resolve image src: convert relative /rag/... paths to absolute URLs */
function resolveImageSrc(src: string): string {
  if (!src) return src;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return src;
  }
  const base = normalizeApiBase(API_BASE);
  return src.startsWith("/") ? `${base}${src}` : `${base}/${src}`;
}

/** Max textarea height in px -- roughly 3 lines of text */
const MAX_TEXTAREA_HEIGHT = 80;

export function QAShell({
  title = "HDMS 城市设计问答",
  subtitle = "基于课题知识库的智能问答",
  messages,
  input,
  isSending = false,
  quickQuestions = [],
  onInputChange,
  onSend,
  onFeedback,
}: QAShellProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { lightboxSrc, open: openLightbox, close: closeLightbox } = useImageLightbox();

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isSending]);

  // Auto-resize textarea based on content, up to MAX_TEXTAREA_HEIGHT
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [input]);

  const canSend = !isSending && input.trim().length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  };

  // Only show quick questions before the user has sent any message
  const hasUserMessage = messages.some((m) => m.role === "user");
  const showQuickQuestions = !hasUserMessage && quickQuestions.length > 0;

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

            const assistantCard = message.role === "assistant";

            return (
              <div
                key={message.id}
                className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "rounded-lg px-4 py-2 text-sm leading-relaxed",
                    message.role === "user"
                      ? "max-w-[80%] bg-primary text-primary-foreground"
                      : "w-full max-w-[min(1100px,95%)] bg-muted text-foreground"
                  )}
                >
                  {assistantCard ? (
                    <AssistantContent
                      message={message}
                      precedingQuestion={precedingQuestion}
                      onFeedback={onFeedback}
                      onSend={onSend}
                      onFillInput={onInputChange}
                      onImageClick={openLightbox}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                  <p
                    className={cn(
                      "mt-1 text-[11px]",
                      message.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"
                    )}
                  >
                    {message.createdAt}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showQuickQuestions && (
        <div className="border-t border-border bg-card px-6 py-3">
          <div className="flex flex-wrap gap-2">
            {quickQuestions.map((question) => (
              <Button
                key={question}
                variant="secondary"
                size="sm"
                className="text-xs"
                onClick={() => onInputChange(question)}
                disabled={isSending}
              >
                {question}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border bg-card px-6 py-4">
        <div className="flex items-end gap-3">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入您的问题，按 Enter 发送，Shift+Enter 换行"
            className="min-h-[40px] max-h-[80px] resize-none overflow-y-auto"
            rows={1}
          />
          <Button
            onClick={() => onSend()}
            disabled={!canSend}
            className="h-[40px] shrink-0 px-4"
          >
            <Send className="mr-2 h-4 w-4" />
            {isSending ? "发送中" : "发送"}
          </Button>
        </div>
      </div>

      {/* Image lightbox */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={closeLightbox}
        >
          <img
            src={lightboxSrc}
            alt="放大查看"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

/** Renders assistant message with thinking, retrieval stats, markdown, citations, sources, feedback, and recommended questions. */
function AssistantContent({
  message,
  precedingQuestion,
  onFeedback,
  onSend,
  onFillInput,
  onImageClick,
}: {
  message: ChatMessage;
  precedingQuestion?: string;
  onFeedback?: (messageId: string, feedback: "useful" | "not_useful") => void;
  onSend?: (question?: string) => void;
  onFillInput?: (value: string) => void;
  onImageClick?: (src: string) => void;
}) {
  const { content, thinking, sources, retrievalStats, feedback, isStreaming } = message;
  const [activeCitation, setActiveCitation] = useState<number | null>(null);

  const sourceCount = sources?.length ?? 0;

  const { cleanContent, questions: recommendedQuestions } = useMemo(
    () => (isStreaming ? { cleanContent: content, questions: [] } : extractRecommendedQuestions(content)),
    [content, isStreaming]
  );

  const answerMarkdown = useMemo(
    () => injectCitationAnchors(cleanContent, sourceCount),
    [cleanContent, sourceCount]
  );

  useEffect(() => {
    setActiveCitation(null);
  }, [message.id]);

  const handleCitationSelect = useCallback((index: number) => {
    setActiveCitation(index);
    const target = document.getElementById(`source-${index}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("qa-source-flash");
      setTimeout(() => target.classList.remove("qa-source-flash"), 1200);
    }
  }, []);

  const hasSourcePanel = Boolean(sources && sources.length > 0 && !isStreaming);

  return (
    <div>
      {(isStreaming || thinking) && (
        <ThinkingProcess thinking={thinking || ""} isStreaming={!!isStreaming} statusMessage={message.statusMessage} />
      )}

      {retrievalStats && <QARetrievalStats stats={retrievalStats} isStreaming={!!isStreaming} />}

      {/* Knowledge Graph Visualization */}
      {message.subgraph && message.subgraph.nodes.length > 0 && (
        <details className="my-2" open={!isStreaming}>
          <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            知识图谱推理路径 ({message.subgraph.nodes.length} 个节点, {message.subgraph.edges.length} 条关系)
          </summary>
          <div className="mt-1 rounded-lg border border-border overflow-hidden">
            <KnowledgeGraph
              subgraph={message.subgraph}
              isStreaming={!!isStreaming}
              height={300}
            />
          </div>
        </details>
      )}

      {content ? (
        <div
          className={cn(
            hasSourcePanel && "mt-1 grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]"
          )}
        >
          <div className="qa-markdown prose prose-sm max-w-none dark:prose-invert">
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
                img: ({ src, alt }) => {
                  const resolved = resolveImageSrc(typeof src === "string" ? src : "");
                  return (
                    <img
                      src={resolved}
                      alt={alt ?? "参考图片"}
                      className="my-2 max-h-80 cursor-zoom-in rounded border border-border object-contain transition-opacity hover:opacity-80"
                      loading="lazy"
                      onClick={() => onImageClick?.(resolved)}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  );
                },
                a: ({ href, children }) => {
                  const citationIndex = parseCitationIndex(href);
                  if (citationIndex) {
                    return (
                      <CitationPill
                        index={citationIndex}
                        source={sources?.[citationIndex - 1]}
                        isActive={activeCitation === citationIndex}
                        onHover={setActiveCitation}
                        onSelect={handleCitationSelect}
                      >
                        {children}
                      </CitationPill>
                    );
                  }

                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      {children}
                    </a>
                  );
                },
              }}
            >
              {answerMarkdown}
            </ReactMarkdown>
            {isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
            )}
          </div>

          {hasSourcePanel && sources && (
            <aside className="self-start xl:sticky xl:top-4">
              <QASources
                sources={sources}
                query={precedingQuestion}
                activeCitation={activeCitation}
                onCitationHover={setActiveCitation}
                onCitationSelect={handleCitationSelect}
                layout="sidebar"
              />
            </aside>
          )}
        </div>
      ) : isStreaming ? (
        <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground" />
      ) : null}

      {/* Recommended questions - subtle inline chips */}
      {!isStreaming && recommendedQuestions.length > 0 && (
        <div className="mt-3 pt-2">
          <p className="mb-1.5 text-xs text-muted-foreground">您可能还想了解：</p>
          <div className="flex flex-wrap gap-1.5">
            {recommendedQuestions.map((q) => (
              <button
                key={q}
                type="button"
                className="rounded-md border border-border/50 bg-card/80 px-3 py-1 text-xs text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:text-foreground hover:shadow"
                onClick={() => onFillInput?.(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

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

function CitationPill({
  index,
  source,
  isActive,
  onHover,
  onSelect,
  children,
}: {
  index: number;
  source?: SourceInfo;
  isActive: boolean;
  onHover: (index: number | null) => void;
  onSelect: (index: number) => void;
  children: React.ReactNode;
}) {
  const typeLabel = source?.source === "knowledge_graph" ? "知识图谱" : "文档检索";

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onSelect(index);
  };

  return (
    <span className="relative inline-flex align-middle">
      <a
        href={`#source-${index}`}
        title={source?.name || `引用 [${index}]`}
        className={cn(
          "inline-flex h-5 min-w-[1.2rem] items-center justify-center rounded px-1 text-[10px] font-semibold no-underline transition-colors",
          "cursor-pointer",
          isActive ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/20"
        )}
        onMouseEnter={() => onHover(index)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(index)}
        onBlur={() => onHover(null)}
        onClick={handleClick}
      >
        {children}
      </a>

      {isActive && source && (
        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-64 -translate-x-1/2 rounded-md border border-border bg-popover p-2 text-[11px] text-popover-foreground shadow-md">
          <span className="line-clamp-1 block font-medium">{source.name || "未知来源"}</span>
          {source.section && (
            <span className="mt-0.5 line-clamp-1 block text-muted-foreground">{source.section}</span>
          )}
          <span className="mt-1 block text-muted-foreground">
            {typeLabel}
            {typeof source.page === "number" && source.page > 0 ? ` · 第 ${source.page} 页` : ""}
          </span>
        </span>
      )}
    </span>
  );
}
