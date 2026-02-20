"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { ThinkingProcess } from "@/components/qa-thinking";
import { QASources } from "@/components/qa-sources";
import { QARetrievalStats } from "@/components/qa-retrieval-stats";
import { QAFeedback } from "@/components/qa-feedback";
import { QAExportButton } from "@/components/qa-export-button";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { PdfLightbox } from "@/components/pdf-lightbox";
import type { ChatMessage, SourceInfo } from "@/features/qa/types";
import { cn } from "@/lib/utils";
import { API_BASE, QA_API_BASE, normalizeApiBase } from "@/lib/api-base";
import { injectSourceImages } from "@/lib/inject-source-images";
import { injectSourceTables } from "@/lib/inject-source-tables";
import { normalizeAnswerTables } from "@/lib/normalize-answer-tables";
import { normalizeAnswerMarkdownArtifacts } from "@/lib/normalize-answer-markdown-artifacts";
import { QA_REMARK_PLUGINS } from "@/lib/qa-markdown-plugins";
import { resolvePdfUrlForSource } from "@/lib/resolve-pdf-url";
import { resolvePdfSearchKeyword } from "@/lib/pdf-auto-highlight";
import { sanitizeAnswerCitations } from "@/lib/sanitize-answer-citations";
import { normalizeCitationSources } from "@/lib/normalize-citation-sources";
import { stripInlineCitationLabels } from "@/lib/strip-inline-citation-labels";
import { convertCitationsToAnchors } from "@/lib/convert-citations-to-anchors";
import { collapseFigureMentions } from "@/lib/stream-source-utils";

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

const RETRIEVAL_DOC_NAME_PATTERN = /([A-Za-z0-9\u4e00-\u9fff_\-（）()《》【】·、]+\.pdf)/giu;

function highlightRetrievalDocNames(node: ReactNode, keyPrefix = "doc"): ReactNode {
  if (typeof node === "string") {
    const parts: ReactNode[] = [];
    let last = 0;
    let index = 0;
    RETRIEVAL_DOC_NAME_PATTERN.lastIndex = 0;
    for (const match of node.matchAll(RETRIEVAL_DOC_NAME_PATTERN)) {
      const start = match.index ?? 0;
      const full = match[0];
      if (start > last) parts.push(node.slice(last, start));
      parts.push(
        <span key={`${keyPrefix}-${index}`} className="italic text-sky-600/80">
          {full}
        </span>
      );
      last = start + full.length;
      index += 1;
    }
    if (last === 0) return node;
    if (last < node.length) parts.push(node.slice(last));
    return parts;
  }
  if (Array.isArray(node)) {
    return node.map((child, idx) => highlightRetrievalDocNames(child, `${keyPrefix}-${idx}`));
  }
  return node;
}

/**
 * Build a map from citation_label (e.g. "1-1") to source array index.
 */
function buildLabelIndexMap(sources: SourceInfo[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!sources) return map;
  for (let i = 0; i < sources.length; i++) {
    const label = sources[i].citation_label;
    if (label) map.set(label, i);
  }
  return map;
}

/**
 * Post-process LLM output to normalize citation placement (N-M format):
 * 1. Move citations before punctuation: "内容。[1-1]" → "内容[1-1]。"
 * 2. Strip citations inside markdown table rows
 * 3. If sources exist but no citations found, append a summary line
 */
function normalizeCitations(text: string, sources: SourceInfo[]): string {
  if (!text) return text;

  let result = text;
  const validLabels = new Set(sources.map((s) => s.citation_label).filter((v): v is string => Boolean(v)));

  result = result.replace(
    /([。！？.!?])(\s*(?:\[\d{1,2}-\d{1,2}\])+)/g,
    (_, punct, cites) => `${cites.trim()}${punct}`
  );

  result = result.replace(
    /^(\|.+)$/gm,
    (line) => line.replace(/\[\d{1,2}-\d{1,2}\]/g, "")
  );

  result = sanitizeAnswerCitations({ text: result, validLabels });

  return result;
}

/**
 * Parse href like #source-1-2 and return the citation label "1-2".
 */
function parseCitationLabel(href?: string): string | null {
  if (!href) return null;
  const match = href.match(/^#source-(\d{1,2}-\d{1,2})$/);
  return match ? match[1] : null;
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
  const base = src.startsWith("/rag/")
    ? normalizeApiBase(QA_API_BASE)
    : normalizeApiBase(API_BASE);
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
  const userScrolledUpRef = useRef(false);
  const { lightboxSrc, open: openLightbox, close: closeLightbox } = useImageLightbox();

  // Detect if user has scrolled away from the bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 80;
  }, []);

  // When a new user message is sent, reset scroll lock so we follow the response
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "user") {
      userScrolledUpRef.current = false;
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [messages.length]);

  useEffect(() => {
    if (!scrollRef.current || userScrolledUpRef.current) return;
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

      <div className="qa-scrollbar flex-1 overflow-y-auto px-6 py-4" ref={scrollRef} onScroll={handleScroll}>
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
  const { content, thinking, sources, retrievalStats, feedback, isStreaming, thinkingDone } = message;
  const [activeCitationLabel, setActiveCitationLabel] = useState<string | null>(null);
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  const [pdfSearchKeyword, setPdfSearchKeyword] = useState<string | undefined>(undefined);
  const markdownRef = useRef<HTMLDivElement>(null);

  // Detect overflowing KaTeX display formulas and add scroll-hint class.
  useEffect(() => {
    const el = markdownRef.current;
    if (!el) return;
    const displays = el.querySelectorAll<HTMLElement>(".katex-display");
    displays.forEach((d) => {
      if (d.scrollWidth > d.clientWidth + 2) {
        d.classList.add("katex-overflow");
      } else {
        d.classList.remove("katex-overflow");
      }
    });
  }, [content, isStreaming]);

  const sourcesNormalized = useMemo(() => normalizeCitationSources(sources ?? []), [sources]);
  const labelIndexMap = useMemo(() => buildLabelIndexMap(sourcesNormalized), [sourcesNormalized]);

  const { cleanContent, questions: recommendedQuestions } = useMemo(
    () => (isStreaming ? { cleanContent: content, questions: [] } : extractRecommendedQuestions(content)),
    [content, isStreaming]
  );

  const answerMarkdown = useMemo(() => {
    const withTables = normalizeAnswerTables(cleanContent);
    const withArtifacts = normalizeAnswerMarkdownArtifacts(withTables, {
      streaming: isStreaming,
    });
    const normalized = isStreaming ? withArtifacts : normalizeCitations(withArtifacts, sourcesNormalized);
    const validLabels = new Set(
      sourcesNormalized.map((s) => s.citation_label).filter((v): v is string => Boolean(v))
    );
    const withAnchors = isStreaming ? normalized : convertCitationsToAnchors(normalized, validLabels);
    const withoutInlineCitations = stripInlineCitationLabels(withAnchors);
    if (isStreaming) {
      // Keep streaming text stable; inject images only after the answer is complete.
      return collapseFigureMentions(withoutInlineCitations);
    }
    const withImages = injectSourceImages(withoutInlineCitations, sourcesNormalized, precedingQuestion);
    const withTablesAndImages = injectSourceTables(withImages, sourcesNormalized);
    return collapseFigureMentions(withTablesAndImages);
  }, [cleanContent, sourcesNormalized, isStreaming, precedingQuestion]);

  useEffect(() => {
    setActiveCitationLabel(null);
  }, [message.id]);

  const handleCitationSelect = useCallback((label: string) => {
    setActiveCitationLabel(label);
    const idx = labelIndexMap.get(label);
    const src = idx !== undefined ? sourcesNormalized?.[idx] : undefined;
    if (src) {
      void resolvePdfUrlForSource(src).then((url) => {
        if (url) {
          setPdfSrc(url);
          setPdfSearchKeyword(resolvePdfSearchKeyword(src));
          return;
        }

        // Fall back to scrolling the source card into view when no PDF is available.
        const target = document.getElementById(`source-${label}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add("qa-source-flash");
          setTimeout(() => target.classList.remove("qa-source-flash"), 1200);
        }
      });
      return;
    }
    const target = document.getElementById(`source-${label}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("qa-source-flash");
      setTimeout(() => target.classList.remove("qa-source-flash"), 1200);
    }
  }, [labelIndexMap, sourcesNormalized]);

  const hasSourcePanel = Boolean(sourcesNormalized && sourcesNormalized.length > 0 && !isStreaming);

  return (
    <div>
      {(isStreaming || thinking) && (
        <ThinkingProcess
          thinking={thinking || ""}
          isStreaming={!!isStreaming}
          thinkingDone={!!thinkingDone}
          statusMessage={message.statusMessage}
          statusStage={message.statusStage}
          retrievalStats={retrievalStats}
        />
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
          <div ref={markdownRef} className="qa-markdown prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown
              remarkPlugins={QA_REMARK_PLUGINS}
              rehypePlugins={[rehypeKatex]}
              components={{
                h2: ({ children }) => (
                  <h2 className="qa-heading-1 mt-5 mb-2 text-base font-bold border-l-4 border-primary pl-2">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="qa-heading-2 mt-4 mb-1.5 text-[15px] font-semibold text-primary/85">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="qa-heading-3 mt-3 mb-1 text-sm font-medium text-foreground/80">
                    {children}
                  </h4>
                ),
                p: ({ children }) => {
                  const isPlainText =
                    typeof children === "string" ||
                    (Array.isArray(children) && children.every((c) => typeof c === "string"));
                  const plain = isPlainText
                    ? String(Array.isArray(children) ? children.join("") : children).trim()
                    : null;

                  if (plain && (plain.startsWith("FIGCAPTION ") || /^图\d+[：:.]/.test(plain))) {
                    const shown = plain.replace(/^FIGCAPTION\s+/u, "");
                    return (
                      <p className="mt-1 mb-3 text-[11px] leading-snug text-left text-muted-foreground/75">
                        {shown}
                      </p>
                    );
                  }

                  return <p className="mb-2 last:mb-0">{children}</p>;
                },
                ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
                ol: ({ children }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
                li: ({ children }) => {
                  const plainText =
                    typeof children === "string"
                      ? children
                      : Array.isArray(children)
                        ? children.filter((c) => typeof c === "string").join("").trim()
                        : "";
                  const isRetrievalReason = plainText.startsWith("资料调用理由（");
                  const isRetrievalList = plainText.startsWith("检索资料清单");
                  const className = isRetrievalReason
                    ? "mb-1 last:mb-0"
                    : "mb-1 last:mb-0";
                  const content = (isRetrievalReason || isRetrievalList)
                    ? highlightRetrievalDocNames(children, "retrieval-doc")
                    : children;
                  return <li className={className}>{content}</li>;
                },
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em className="italic text-sky-700/80">{children}</em>,
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
                  <blockquote className="rounded-md border border-border/55 bg-background/85 px-3 py-2 text-xs leading-relaxed text-muted-foreground shadow-sm">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="qa-table-wrap mb-2 overflow-x-auto rounded-md border border-border/80 bg-white/90 dark:bg-background/75">
                    <table className="min-w-full border-collapse text-xs">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-border bg-white/80 px-2 py-1 text-left font-semibold dark:bg-muted/45">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-border bg-white/55 px-2 py-1 dark:bg-transparent">{children}</td>
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
                        const img = e.target as HTMLImageElement;
                        img.alt = "";
                        img.title = "参考图片暂不可用";
                        // Hide broken-image icon and fallback alt text to keep layout clean.
                        img.style.display = "none";
                      }}
                    />
                  );
                },
                a: ({ href, children }) => {
                  const citationLabel = parseCitationLabel(href);
                  if (citationLabel !== null) {
                    const sourceIdx = labelIndexMap.get(citationLabel);
                    const source = sourceIdx !== undefined ? sources?.[sourceIdx] : undefined;
                    return (
                      <CitationPill
                        label={citationLabel}
                        source={source}
                        isActive={activeCitationLabel === citationLabel}
                        onHover={setActiveCitationLabel}
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

          {hasSourcePanel && sourcesNormalized && (
            <aside className="self-start xl:sticky xl:top-4">
              <QASources
                sources={sourcesNormalized}
                query={precedingQuestion}
                activeCitation={activeCitationLabel}
                onCitationHover={setActiveCitationLabel}
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

      {pdfSrc && (
        <PdfLightbox
          src={pdfSrc}
          searchKeyword={pdfSearchKeyword}
          onClose={() => {
            setPdfSrc(null);
            setPdfSearchKeyword(undefined);
          }}
        />
      )}
    </div>
  );
}

function CitationPill({
  label,
  source,
  isActive,
  onHover,
  onSelect,
  children,
}: {
  label: string;
  source?: SourceInfo;
  isActive: boolean;
  onHover: (label: string | null) => void;
  onSelect: (label: string) => void;
  children: React.ReactNode;
}) {
  const typeLabel = source?.source === "knowledge_graph" ? "知识图谱" : "文档检索";

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onSelect(label);
  };

  const displayLabel = label;

  return (
    <span className="relative inline-flex align-middle">
      <a
        href={`#source-${label}`}
        title={source?.name || `引用 [${label}]`}
        className={cn(
          "inline-flex h-5 items-center justify-center rounded-full border px-1.5 text-[10px] font-medium no-underline transition-colors",
          "cursor-pointer",
          isActive
            ? "border-red-600 bg-red-600 text-white"
            : "border-red-400 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
        )}
        onMouseEnter={() => onHover(label)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(label)}
        onBlur={() => onHover(null)}
        onClick={handleClick}
      >
        {displayLabel}
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
