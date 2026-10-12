"use client";

import { useCallback, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { QAFeedback } from "@/components/qa-feedback";
import { splitAnswerSupplements } from "@/features/qa/render/answer-supplements";
import {
  buildAssistantRenderModel,
  deriveAssistantRenderState,
  resolveAnswerRenderPhase,
} from "@/features/qa/render/assistant-render-state-machine";
import { resolveAssistantAnswerMarkdown } from "@/features/qa/render/resolve-answer-markdown";
import type { ChatMessage } from "@/features/qa/types";
import { cn } from "@/lib/utils";
import { QACitationSourcePanel, useCitationState } from "./qa-citation-source-panel";
import { QAMarkdownRenderer } from "./qa-markdown-renderer";

interface CitationBackTarget {
  savedScrollTop: number;
  originId: string | null;
}

interface CitationClickPayload {
  label: string;
  originId: string | null;
}

interface AssistantContentProps {
  message: ChatMessage;
  embedded?: boolean;
  precedingQuestion?: string;
  onFeedback?: (messageId: string, feedback: "useful" | "not_useful") => void;
  onFillInput?: (value: string) => void;
  onImageClick?: (src: string) => void;
  onCitationJump?: (payload: CitationBackTarget) => void;
  scrollRef?: RefObject<HTMLElement | null>;
}

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

  return {
    cleanContent: content.replace(pattern, "").trimEnd(),
    questions,
  };
}

export function AssistantContent({
  message,
  embedded,
  precedingQuestion,
  onFeedback,
  onFillInput,
  onImageClick,
  onCitationJump,
  scrollRef,
}: AssistantContentProps) {
  const sourceScrollRef = useRef<HTMLDivElement>(null);
  const {
    content,
    stableMarkdown,
    sources,
    retrievalStats,
    feedback,
    isStreaming,
    finalizedByServer,
    statusMessage,
  } = message;

  const {
    sourcesNormalized,
    activeCitationLabel,
    handleCitationSelect,
    citationAnchorComponent,
  } = useCitationState({
    sources,
    messageId: message.id,
    scrollRef,
    sourceScrollRef,
    sourceTargetsEnabled: Boolean(!isStreaming && sources && sources.length > 0),
    onCitationJump,
  });

  const handleCitationClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const pill = target.closest("[data-citation-label]");
    if (!(pill instanceof HTMLAnchorElement)) return;
    if (pill.dataset.citationHandled === "true") return;

    const label = pill.getAttribute("data-citation-label");
    if (!label) return;

    event.preventDefault();
    event.stopPropagation();
    handleCitationSelect({
      label,
      originId: pill.getAttribute("data-citation-origin-id"),
    } satisfies CitationClickPayload);
  }, [handleCitationSelect]);

  const renderState = deriveAssistantRenderState(message);
  const answerRenderPhase = resolveAnswerRenderPhase({
    state: renderState,
    isStreaming: Boolean(isStreaming),
  });
  const { cleanContent, questions: recommendedQuestions } = useMemo(
    () => (isStreaming ? { cleanContent: content, questions: [] } : extractRecommendedQuestions(content)),
    [content, isStreaming],
  );
  const answerMarkdown = resolveAssistantAnswerMarkdown({
    content: cleanContent,
    stableMarkdown,
    sources: sourcesNormalized,
    isStreaming: Boolean(isStreaming),
    renderPhase: answerRenderPhase,
    precedingQuestion,
    finalizedByServer,
  });
  const { markdown: mainAnswerMarkdown, supplements } = splitAnswerSupplements(answerMarkdown);
  const renderModel = buildAssistantRenderModel({
    state: renderState,
    isStreaming: Boolean(isStreaming),
    hasAnswer: Boolean(content),
    hasRetrievalStats: Boolean(retrievalStats),
  });
  const hasSourcePanel = Boolean(!isStreaming && sourcesNormalized && sourcesNormalized.length > 0);
  const useSidebarSourceLayout = hasSourcePanel && !embedded;

  return (
    <div>
      {message.subgraph && message.subgraph.nodes.length > 0 && (
        <details className="my-2" open={!isStreaming}>
          <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            知识图谱推理路径 ({message.subgraph.nodes.length} 个节点, {message.subgraph.edges.length} 条关系)
          </summary>
          <div className="mt-1 rounded-lg border border-border overflow-hidden">
            <KnowledgeGraph subgraph={message.subgraph} isStreaming={!!isStreaming} height={300} />
          </div>
        </details>
      )}

      {renderModel.showAnswer && content ? (
        <div
          className={cn(useSidebarSourceLayout && "mt-1 grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]")}
          onClickCapture={handleCitationClickCapture}
        >
          <div className="min-w-0">
            <QAMarkdownRenderer
              markdown={mainAnswerMarkdown}
              componentOverrides={{ a: citationAnchorComponent }}
              showStreamingCursor={renderModel.showStreamingCursor}
              onImageClick={onImageClick}
              isStreaming={isStreaming}
            />

            {supplements.length > 0 && (
              <div className="mt-4 space-y-2">
                {supplements.map((supplement) => (
                  <section
                    key={supplement.id}
                    className="rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-white px-4 py-3 shadow-[0_10px_24px_rgba(245,158,11,0.08)]"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="inline-flex h-6 items-center rounded-full bg-amber-100 px-2.5 text-[11px] font-semibold tracking-[0.02em] text-amber-800">
                        {supplement.title}
                      </span>
                      <span className="text-[11px] text-amber-700/80">基于当前检索材料的边界提醒</span>
                    </div>
                    <QAMarkdownRenderer
                      markdown={supplement.markdown}
                      componentOverrides={{ a: citationAnchorComponent }}
                      onImageClick={onImageClick}
                      className="prose-sm prose-p:mb-0 prose-p:text-[13px] prose-p:leading-6"
                    />
                  </section>
                ))}
              </div>
            )}
          </div>

          {hasSourcePanel && (
            <QACitationSourcePanel
              sources={sourcesNormalized}
              messageId={message.id}
              query={precedingQuestion}
              activeCitationLabel={activeCitationLabel}
              layout={useSidebarSourceLayout ? "sidebar" : "inline"}
              sourceScrollRef={sourceScrollRef}
            />
          )}
        </div>
      ) : renderModel.showLoadingIndicator ? (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="flex min-h-7 items-center gap-2.5 text-xs text-muted-foreground"
        >
          <span className="flex items-center gap-1" aria-hidden="true">
            <span className="qa-inline-dot qa-inline-dot--1" />
            <span className="qa-inline-dot qa-inline-dot--2" />
            <span className="qa-inline-dot qa-inline-dot--3" />
          </span>
          <span>{statusMessage || "正在查询答案..."}</span>
        </div>
      ) : renderModel.showStreamingCursor ? (
        <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground" />
      ) : null}

      {!isStreaming && recommendedQuestions.length > 0 && (
        <div className="mt-3 pt-2">
          <p className="mb-1.5 text-xs text-muted-foreground">您可能还想了解：</p>
          <div className="flex flex-wrap gap-1.5">
            {recommendedQuestions.map((question) => (
              <button
                key={question}
                type="button"
                className="rounded-md border border-border/50 bg-card/80 px-3 py-1 text-xs text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:text-foreground hover:shadow"
                onClick={() => onFillInput?.(question)}
              >
                {question}
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
          onFeedbackChange={(nextFeedback) => onFeedback(message.id, nextFeedback)}
        />
      )}
    </div>
  );
}
