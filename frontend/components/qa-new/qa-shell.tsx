/**
 * QA Shell 主容器组件
 * 管理问答界面的消息列表、输入框、快捷问题、反馈、导出、知识图谱等功能，
 * 协调 Markdown 渲染、思考过程展示、引用面板等子组件。
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, ChevronUp, ImagePlus, Send, Square, X } from "lucide-react";
import { ThinkingProcess } from "@/components/qa-thinking";
import { QAFeedback } from "@/components/qa-feedback";
import { QAExportButton } from "@/components/qa-export-button";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import type { ChatMessage } from "@/features/qa/types";
import { cn } from "@/lib/utils";
import { buildAnswerMarkdown } from "@/features/qa/render/answer-markdown-pipeline";
import {
  buildAssistantRenderModel,
  deriveAssistantRenderState,
  resolveAnswerRenderPhase,
} from "@/features/qa/render/assistant-render-state-machine";
import { QAMarkdownRenderer } from "./qa-markdown-renderer";
import { useCitationState, QACitationSourcePanel } from "./qa-citation-source-panel";

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

const INPUT_MIN_LINES = 1;
const INPUT_MAX_LINES = 3;
const INPUT_LINE_HEIGHT_PX = 22;
const INPUT_VERTICAL_PADDING_PX = 22; // py-[11px] top + bottom
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
  const programmaticScrollRef = useRef(false);
  const { lightboxSrc, open: openLightbox, close: closeLightbox } = useImageLightbox();
  const [pendingImages, setPendingImages] = useState<PendingUploadImage[]>([]);
  const [isInputScrollbarActive, setIsInputScrollbarActive] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const [backScrollPos, setBackScrollPos] = useState<number | null>(null);

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
    // Only dismiss back-to-citation button on user-initiated scroll
    if (!programmaticScrollRef.current) {
      setBackScrollPos(null);
    }
  }, [syncScrollPositionState]);

  const handleJumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    userScrolledUpRef.current = false;
    setShowJumpToBottom(false);
  }, []);

  const handleCitationJump = useCallback((savedScrollTop: number) => {
    programmaticScrollRef.current = true;
    setBackScrollPos(savedScrollTop);
    // Clear the flag after smooth scroll settles (~600ms)
    setTimeout(() => { programmaticScrollRef.current = false; }, 600);
  }, []);

  const handleBackToCitation = useCallback(() => {
    const el = scrollRef.current;
    if (el === null || backScrollPos === null) return;
    el.scrollTo({ top: backScrollPos, behavior: "smooth" });
    setBackScrollPos(null);
  }, [backScrollPos]);

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
        {backScrollPos !== null && (
          <button
            type="button"
            className="absolute left-1/2 top-3 z-30 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/70 bg-white/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-white hover:text-foreground dark:bg-card/95 dark:hover:bg-card"
            onClick={handleBackToCitation}
            aria-label="返回引用位置"
          >
            <ChevronUp className="h-3.5 w-3.5" />
            返回引用位置
          </button>
        )}
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
                        onCitationJump={handleCitationJump}
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
              "min-h-[44px] max-h-[82px] resize-none overflow-y-auto border-0 bg-transparent py-[11px] pr-[88px] leading-[22px] shadow-none focus-visible:ring-0",
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
                "pointer-events-auto h-8 w-8 cursor-pointer border text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed",
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
              variant="ghost"
              size="icon"
              className={cn(
                "pointer-events-auto h-8 w-8 cursor-pointer rounded-lg border-0 text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary disabled:cursor-not-allowed"
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

/** Renders assistant message: orchestrates markdown renderer, citation/source panel, thinking, graph, feedback. */
function AssistantContent({
  message,
  embedded,
  precedingQuestion,
  onFeedback,
  onSend,
  onFillInput,
  onImageClick,
  onCitationJump,
  scrollRef,
}: {
  message: ChatMessage;
  embedded?: boolean;
  precedingQuestion?: string;
  onFeedback?: (messageId: string, feedback: "useful" | "not_useful") => void;
  onSend?: (question?: string) => void;
  onFillInput?: (value: string) => void;
  onImageClick?: (src: string) => void;
  onCitationJump?: (savedScrollTop: number) => void;
  scrollRef?: React.RefObject<HTMLElement | null>;
}) {
  const {
    content,
    thinking,
    sources,
    retrievalStats,
    feedback,
    isStreaming,
    thinkingDone,
    finalizedByServer,
  } = message;

  // --- Citation state (isolated module) ---
  const {
    sourcesNormalized,
    handleCitationSelect,
    citationAnchorComponent,
  } = useCitationState({ sources, messageId: message.id, scrollRef, onCitationJump });

  // --- Render state derivation ---
  const renderState = deriveAssistantRenderState(message);
  const answerRenderPhase = resolveAnswerRenderPhase({
    state: renderState,
    isStreaming: Boolean(isStreaming),
  });

  const { cleanContent, questions: recommendedQuestions } = useMemo(
    () => (isStreaming ? { cleanContent: content, questions: [] } : extractRecommendedQuestions(content)),
    [content, isStreaming]
  );

  const answerMarkdown = useMemo(() => {
    return buildAnswerMarkdown({
      content: cleanContent,
      sources: sourcesNormalized,
      isStreaming: Boolean(isStreaming),
      renderPhase: answerRenderPhase,
      precedingQuestion,
      finalizedByServer,
    });
  }, [cleanContent, sourcesNormalized, isStreaming, answerRenderPhase, precedingQuestion, finalizedByServer]);

  const hasThinkingTokens = Boolean((thinking || "").trim());
  const renderModel = buildAssistantRenderModel({
    state: renderState,
    isStreaming: Boolean(isStreaming),
    hasThinking: hasThinkingTokens,
    hasAnswer: Boolean(content),
    hasRetrievalStats: Boolean(retrievalStats),
  });

  // User expectation: show source panel only after full streaming completes.
  const hasSourcePanel = Boolean(!isStreaming && sourcesNormalized && sourcesNormalized.length > 0);
  const useSidebarSourceLayout = hasSourcePanel && !embedded;

  return (
    <div>
      {renderModel.showThinking && (
        <ThinkingProcess
          thinking={thinking || ""}
          isStreaming={!!isStreaming}
          thinkingDone={!!thinkingDone}
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

      {renderModel.showAnswer && content ? (
        <div
          className={cn(
            useSidebarSourceLayout && "mt-1 grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]"
          )}
        >
          {/* Markdown rendering (isolated module) */}
          <QAMarkdownRenderer
            markdown={answerMarkdown}
            componentOverrides={{ a: citationAnchorComponent }}
            showStreamingCursor={renderModel.showStreamingCursor}
            onImageClick={onImageClick}
            isStreaming={isStreaming}
          />

          {/* Citation source panel (isolated module) */}
          {hasSourcePanel && (
            <QACitationSourcePanel
              sources={sourcesNormalized}
              messageId={message.id}
              query={precedingQuestion}
              onCitationSelect={handleCitationSelect}
              layout={useSidebarSourceLayout ? "sidebar" : "inline"}
            />
          )}
        </div>
      ) : renderModel.showStreamingCursor ? (
        <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground" />
      ) : null}

      {/* Recommended questions */}
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
