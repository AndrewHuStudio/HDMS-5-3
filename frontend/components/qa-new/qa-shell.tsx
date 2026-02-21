"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, ImagePlus, Send, Square, X } from "lucide-react";
import { ThinkingProcess } from "@/components/qa-thinking";
import { QASources } from "@/components/qa-sources";
import { QARetrievalStats } from "@/components/qa-retrieval-stats";
import { QAFeedback } from "@/components/qa-feedback";
import { QAExportButton } from "@/components/qa-export-button";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import type { ChatMessage, SourceInfo } from "@/features/qa/types";
import { cn } from "@/lib/utils";
import { API_BASE, QA_API_BASE, normalizeApiBase } from "@/lib/api-base";
import { injectSourceImages } from "@/lib/inject-source-images";
import { injectSourceTables } from "@/lib/inject-source-tables";
import { normalizeAnswerTables } from "@/lib/normalize-answer-tables";
import { normalizeAnswerMarkdownArtifacts } from "@/lib/normalize-answer-markdown-artifacts";
import { QA_REMARK_PLUGINS } from "@/lib/qa-markdown-plugins";
import { sanitizeAnswerCitations } from "@/lib/sanitize-answer-citations";
import { normalizeCitationSources } from "@/lib/normalize-citation-sources";
import { stripInlineCitationLabels } from "@/lib/strip-inline-citation-labels";
import { convertCitationsToAnchors } from "@/lib/convert-citations-to-anchors";
import { collapseFigureMentions } from "@/lib/stream-source-utils";

interface QAShellProps {
  title?: string;
  subtitle?: string;
  embedded?: boolean;
  messages: ChatMessage[];
  input: string;
  isSending?: boolean;
  quickQuestions?: string[];
  onInputChange: (value: string) => void;
  onSend: (question?: string) => void;
  onStop?: () => void;
  onFeedback?: (messageId: string, feedback: "useful" | "not_useful") => void;
}

interface PendingUploadImage {
  id: string;
  name: string;
  previewUrl: string;
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
  if (src.startsWith("/api/")) return src;
  const base = src.startsWith("/rag/")
    ? normalizeApiBase(QA_API_BASE)
    : normalizeApiBase(API_BASE);
  return src.startsWith("/") ? `${base}${src}` : `${base}/${src}`;
}

const INPUT_MIN_LINES = 1;
const INPUT_MAX_LINES = 3;
const INPUT_LINE_HEIGHT_PX = 22;
const INPUT_VERTICAL_PADDING_PX = 16;
const MIN_TEXTAREA_HEIGHT = INPUT_MIN_LINES * INPUT_LINE_HEIGHT_PX + INPUT_VERTICAL_PADDING_PX;
const MAX_TEXTAREA_HEIGHT = INPUT_MAX_LINES * INPUT_LINE_HEIGHT_PX + INPUT_VERTICAL_PADDING_PX;
const INPUT_SCROLLBAR_ACTIVE_MS = 260;
const MAX_PENDING_UPLOAD_IMAGES = 4;
const UPLOADED_IMAGE_HINT_PREFIX = "已上传图片：";
const SCROLL_BOTTOM_THRESHOLD_PX = 80;

export function QAShell({
  title = "HDMS 城市设计问答",
  subtitle = "基于课题知识库的智能问答",
  embedded = false,
  messages,
  input,
  isSending = false,
  quickQuestions = [],
  onInputChange,
  onSend,
  onStop,
  onFeedback,
}: QAShellProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const inputScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingImagesRef = useRef<PendingUploadImage[]>([]);
  const userScrolledUpRef = useRef(false);
  const { lightboxSrc, open: openLightbox, close: closeLightbox } = useImageLightbox();
  const [pendingImages, setPendingImages] = useState<PendingUploadImage[]>([]);
  const [isInputScrollbarActive, setIsInputScrollbarActive] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);

  // Detect if user has scrolled away from the bottom
  const syncScrollPositionState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      userScrolledUpRef.current = false;
      setShowJumpToBottom(false);
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isAwayFromBottom = distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX;
    userScrolledUpRef.current = isAwayFromBottom;
    setShowJumpToBottom(isAwayFromBottom);
  }, []);

  const handleScroll = useCallback(() => {
    syncScrollPositionState();
  }, [syncScrollPositionState]);

  const handleJumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    userScrolledUpRef.current = false;
    setShowJumpToBottom(false);
  }, []);

  // When a new user message is sent, reset scroll lock so we follow the response
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "user") {
      userScrolledUpRef.current = false;
      setShowJumpToBottom(false);
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
    setShowJumpToBottom(false);
  }, [messages, isSending]);

  useEffect(() => {
    syncScrollPositionState();
  }, [messages.length, isSending, syncScrollPositionState]);

  // Auto-resize textarea based on content, up to MAX_TEXTAREA_HEIGHT
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.max(
      MIN_TEXTAREA_HEIGHT,
      Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)
    );
    el.style.height = `${nextHeight}px`;
  }, [input, pendingImages.length]);

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;

    const syncHeight = () => setComposerHeight(el.offsetHeight);
    syncHeight();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncHeight());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (inputScrollTimerRef.current) {
        clearTimeout(inputScrollTimerRef.current);
      }
      pendingImagesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
  }, []);

  const clearPendingImages = useCallback(() => {
    setPendingImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
  }, []);

  const buildOutgoingQuestion = useCallback(() => {
    const text = input.trim();
    if (pendingImages.length === 0) return text;
    const uploadedHint = `${UPLOADED_IMAGE_HINT_PREFIX}${pendingImages.map((img) => img.name).join("、")}`;
    return text ? `${text}\n\n${uploadedHint}` : uploadedHint;
  }, [input, pendingImages]);

  const hasPendingImages = pendingImages.length > 0;
  const canSend = !isSending && (input.trim().length > 0 || pendingImages.length > 0);

  const handleSendFromComposer = useCallback(() => {
    const question = buildOutgoingQuestion();
    if (!question) return;
    onSend(question);
    clearPendingImages();
  }, [buildOutgoingQuestion, clearPendingImages, onSend]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        handleSendFromComposer();
      }
    }
  };

  const handleInputScroll = useCallback(() => {
    setIsInputScrollbarActive(true);
    if (inputScrollTimerRef.current) {
      clearTimeout(inputScrollTimerRef.current);
    }
    inputScrollTimerRef.current = setTimeout(() => {
      setIsInputScrollbarActive(false);
      inputScrollTimerRef.current = null;
    }, INPUT_SCROLLBAR_ACTIVE_MS);
  }, []);

  const handleImageUploadChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (selectedFiles.length === 0) {
      event.target.value = "";
      return;
    }

    setPendingImages((prev) => {
      const remainingSlots = Math.max(0, MAX_PENDING_UPLOAD_IMAGES - prev.length);
      if (remainingSlots === 0) return prev;
      const additions = selectedFiles.slice(0, remainingSlots).map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
      }));
      return [...prev, ...additions];
    });

    event.target.value = "";
  }, []);

  const handleRemovePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  const handleOpenImageUpload = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handlePrimaryAction = useCallback(() => {
    if (isSending) {
      onStop?.();
      return;
    }
    if (!canSend) return;
    handleSendFromComposer();
  }, [canSend, handleSendFromComposer, isSending, onStop]);

  // Only show quick questions before the user has sent any message
  const hasUserMessage = messages.some((m) => m.role === "user");
  const showQuickQuestions = !hasUserMessage && quickQuestions.length > 0;

  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full flex-col overflow-hidden bg-white text-foreground dark:bg-background",
        embedded ? "h-full flex-1" : "h-screen"
      )}
    >
      {!embedded && (
        <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <QAExportButton messages={messages} disabled={isSending} />
        </header>
      )}

      <div className="relative flex-1 min-h-0">
        <div className="qa-scrollbar h-full overflow-x-hidden overflow-y-auto bg-white px-6 py-4 dark:bg-background" ref={scrollRef} onScroll={handleScroll}>
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
                      : "w-full max-w-[min(1100px,95%)] border border-border/60 bg-white text-foreground dark:bg-card"
                  )}
                >
                    {assistantCard ? (
                      <AssistantContent
                        message={message}
                        embedded={embedded}
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

      {showJumpToBottom && (
        <button
          type="button"
          className="absolute left-1/2 z-30 inline-flex -translate-x-1/2 items-center justify-center rounded-full border border-border/70 bg-white/95 p-0 text-muted-foreground shadow-sm transition-colors hover:bg-white hover:text-foreground"
          style={{
            width: 40,
            height: 40,
            borderRadius: "9999px",
            bottom: `${Math.max(composerHeight + 12, 80)}px`,
          }}
          onClick={handleJumpToBottom}
          aria-label="回到底部"
          title="回到底部"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}

      <div ref={composerRef} className="relative bg-white px-6 pb-4 pt-2 dark:bg-background">
        <div
          className={cn(
            "relative rounded-2xl border bg-white transition-[border-color,box-shadow] dark:bg-card",
            isComposerFocused || input.trim().length > 0 || pendingImages.length > 0
              ? "border-primary/55 shadow-[0_0_0_1px_rgba(59,130,246,0.2),0_0_16px_rgba(59,130,246,0.16)] dark:shadow-[0_0_0_1px_rgba(96,165,250,0.35),0_0_18px_rgba(96,165,250,0.2)]"
              : "border-border/70"
          )}
        >
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-border/70 px-3 py-2">
              {pendingImages.map((img) => (
                <div key={img.id} className="relative h-12 w-12 overflow-hidden rounded-md border border-border/70">
                  <img src={img.previewUrl} alt={img.name} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    className="absolute right-0 top-0 inline-flex h-4 w-4 items-center justify-center rounded-bl bg-black/65 text-white"
                    onClick={() => handleRemovePendingImage(img.id)}
                    aria-label={`移除 ${img.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={handleInputScroll}
            onFocus={() => setIsComposerFocused(true)}
            onBlur={() => setIsComposerFocused(false)}
            placeholder="有什么我能帮你的吗？"
            className={cn(
              "min-h-[44px] max-h-[82px] resize-none overflow-y-auto border-0 bg-transparent pr-[88px] leading-[22px] shadow-none focus-visible:ring-0",
              "qa-input-scrollbar",
              isInputScrollbarActive && "qa-input-scrollbar--active"
            )}
            rows={1}
          />

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImageUploadChange}
          />

          <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "pointer-events-auto h-8 w-8 cursor-pointer border text-muted-foreground transition-colors disabled:cursor-not-allowed",
                hasPendingImages
                  ? "rounded-md border-border bg-muted/60 text-foreground hover:bg-muted/80"
                  : "rounded-full border-transparent hover:bg-muted/60"
              )}
              onClick={handleOpenImageUpload}
              disabled={isSending || pendingImages.length >= MAX_PENDING_UPLOAD_IMAGES}
              title={pendingImages.length >= MAX_PENDING_UPLOAD_IMAGES ? `最多上传 ${MAX_PENDING_UPLOAD_IMAGES} 张图片` : "上传图片"}
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              className={cn(
                "pointer-events-auto h-8 w-8 cursor-pointer rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed"
              )}
              onClick={handlePrimaryAction}
              disabled={isSending ? !onStop : !canSend}
              title={isSending ? "中止生成" : "发送"}
            >
              {isSending ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
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
  embedded,
  precedingQuestion,
  onFeedback,
  onSend,
  onFillInput,
  onImageClick,
}: {
  message: ChatMessage;
  embedded?: boolean;
  precedingQuestion?: string;
  onFeedback?: (messageId: string, feedback: "useful" | "not_useful") => void;
  onSend?: (question?: string) => void;
  onFillInput?: (value: string) => void;
  onImageClick?: (src: string) => void;
}) {
  const { content, thinking, sources, retrievalStats, feedback, isStreaming, thinkingDone } = message;
  const [activeCitationLabel, setActiveCitationLabel] = useState<string | null>(null);
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
    const target = document.getElementById(`source-${label}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("qa-source-flash");
      setTimeout(() => target.classList.remove("qa-source-flash"), 1200);
    }
  }, []);

  const hasSourcePanel = Boolean(sourcesNormalized && sourcesNormalized.length > 0 && !isStreaming);
  const useSidebarSourceLayout = hasSourcePanel && !embedded;
  const normalizedStatusStage = (message.statusStage || "").trim().toLowerCase();
  const stageReadyForRetrievalSummary =
    normalizedStatusStage === "reasoning" || normalizedStatusStage === "generating";
  const hasThinkingTokens = Boolean((thinking || "").trim());
  const showParallelRetrievalStats = Boolean(retrievalStats) && (
    !isStreaming || stageReadyForRetrievalSummary || Boolean(thinkingDone) || hasThinkingTokens
  );

  return (
    <div>
      {showParallelRetrievalStats && (
        <QARetrievalStats stats={retrievalStats!} isStreaming={!!isStreaming} />
      )}

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
            useSidebarSourceLayout && "mt-1 grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]"
          )}
        >
          <div ref={markdownRef} className="qa-markdown prose prose-sm max-w-none break-words dark:prose-invert">
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
                    <code className={`${className ?? ""} block whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs`}>
                      {children}
                    </code>
                  ) : (
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
                  );
                },
                pre: ({ children }) => <pre className="mb-2 whitespace-pre-wrap break-words">{children}</pre>,
                blockquote: ({ children }) => (
                  <blockquote className="rounded-md border border-border/55 bg-background/85 px-3 py-2 text-xs leading-relaxed text-muted-foreground shadow-sm">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="qa-table-wrap mb-2 overflow-x-hidden rounded-md border border-border/80 bg-white/90 dark:bg-background/75">
                    <table className="w-full table-fixed border-collapse text-xs">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-border bg-white/80 px-2 py-1 text-left font-semibold break-words dark:bg-muted/45">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-border bg-white/55 px-2 py-1 break-words dark:bg-transparent">{children}</td>
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
            <aside className={cn(useSidebarSourceLayout ? "self-start xl:sticky xl:top-4" : "mt-2")}>
              <QASources
                sources={sourcesNormalized}
                query={precedingQuestion}
                activeCitation={activeCitationLabel}
                onCitationHover={setActiveCitationLabel}
                onCitationSelect={handleCitationSelect}
                layout={useSidebarSourceLayout ? "sidebar" : "inline"}
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
  const hoverExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverExitTimer = useCallback(() => {
    if (hoverExitTimerRef.current) {
      clearTimeout(hoverExitTimerRef.current);
      hoverExitTimerRef.current = null;
    }
  }, []);

  const showCitationHover = useCallback(() => {
    clearHoverExitTimer();
    onHover(label);
  }, [clearHoverExitTimer, label, onHover]);

  const hideCitationHover = useCallback(() => {
    clearHoverExitTimer();
    hoverExitTimerRef.current = setTimeout(() => {
      onHover(null);
      hoverExitTimerRef.current = null;
    }, 120);
  }, [clearHoverExitTimer, onHover]);

  useEffect(() => {
    return () => {
      clearHoverExitTimer();
    };
  }, [clearHoverExitTimer]);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onSelect(label);
  };

  const displayLabel = label;

  return (
    <span
      className="relative inline-flex align-middle"
      onMouseEnter={showCitationHover}
      onMouseLeave={hideCitationHover}
    >
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
        onFocus={showCitationHover}
        onBlur={hideCitationHover}
        onClick={handleClick}
      >
        {displayLabel}
      </a>

      {isActive && source && (
        <span className="pointer-events-auto absolute left-1/2 top-full z-20 mt-1 w-64 -translate-x-1/2 rounded-md border border-border bg-popover p-2 text-[11px] text-popover-foreground shadow-md">
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
