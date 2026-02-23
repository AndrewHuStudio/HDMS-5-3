"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronRight, Brain } from "lucide-react";
import type { RetrievalStats } from "@/features/qa/types";
import { buildThinkingSteps } from "./qa-thinking-steps";

interface ThinkingProcessProps {
  thinking: string;
  isStreaming: boolean;
  thinkingDone?: boolean;
  statusMessage?: string;
  statusStage?: string;
  retrievalStats?: RetrievalStats;
}

export function ThinkingProcess({
  thinking,
  isStreaming,
  thinkingDone,
  statusMessage,
  statusStage,
  retrievalStats,
}: ThinkingProcessProps) {
  const [isOpen, setIsOpen] = useState(true);
  const hasThinking = Boolean(thinking.trim());
  const [displayStage, setDisplayStage] = useState<string>(
    statusStage || "understanding"
  );
  const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayStageStartRef = useRef<number>(Date.now());
  const STAGE_MIN_MS: Record<string, number> = {
    understanding: 1000,
    retrieving: 1000,
    reasoning: 1000,
  };

  useEffect(() => {
    displayStageStartRef.current = Date.now();
  }, [displayStage]);

  useEffect(() => {
    if (!isStreaming) {
      if (stageTimerRef.current) {
        clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }
      return;
    }

    const targetStage = statusStage || "understanding";
    if (targetStage === displayStage) return;

    const elapsed = Date.now() - displayStageStartRef.current;
    const minMs = STAGE_MIN_MS[displayStage] ?? 0;
    const remaining = minMs - elapsed;
    if (remaining > 0) {
      if (stageTimerRef.current) {
        clearTimeout(stageTimerRef.current);
      }
      stageTimerRef.current = setTimeout(() => {
        setDisplayStage(targetStage);
        stageTimerRef.current = null;
      }, remaining);
      return;
    }

    setDisplayStage(targetStage);
  }, [displayStage, isStreaming, statusStage]);

  useEffect(() => {
    return () => {
      if (stageTimerRef.current) {
        clearTimeout(stageTimerRef.current);
      }
    };
  }, []);

  const steps = buildThinkingSteps({
    stage: displayStage,
    statusMessage,
    retrievalStats,
  });

  const getStageRank = (stage?: string) => {
    switch ((stage || "").trim().toLowerCase()) {
      case "understanding":
        return 1;
      case "retrieving":
        return 2;
      case "reasoning":
      case "generating":
        return 3;
      default:
        return 0;
    }
  };

  const reachedReasoningStage = getStageRank(displayStage) >= 3;
  const shouldDelayThinkingText = isStreaming && hasThinking && !thinkingDone && !reachedReasoningStage;
  const showStepTimelineBeforeThinking = isStreaming && (!hasThinking || shouldDelayThinkingText);
  const activeIndex = steps.findIndex((step) => step.state === "active");
  const visibleCount = Math.max(1, activeIndex + 1);
  const visibleSteps = steps.slice(0, visibleCount);
  const showThinkingText = hasThinking && !shouldDelayThinkingText;

  // Show "思考中" only when thought tokens are actually rendered.
  const isThinkingActive = isStreaming && !thinkingDone && showThinkingText;

  // Auto-collapse when thinking completes (either via thinkingDone signal or stream end).
  useEffect(() => {
    if ((!isStreaming || thinkingDone) && hasThinking) {
      setIsOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to streaming/thinkingDone changes
  }, [isStreaming, thinkingDone]);

  if (!isStreaming && !hasThinking) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-2">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40">
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform duration-200 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <Brain className="h-3 w-3 shrink-0" />
        <span className={`font-medium ${isThinkingActive ? "text-foreground" : "text-muted-foreground"}`}>
          {isThinkingActive ? "思考中" : "思考过程"}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-2.5 border-l border-border/70 pl-3">
          {showStepTimelineBeforeThinking ? (
            <ol className="qa-thinking-step-list py-0.5">
              {visibleSteps.map((step, index) => (
                <li
                  key={step.key}
                  className={`qa-thinking-step qa-thinking-step--${step.state}`}
                  style={{ "--qa-step-index": index } as CSSProperties}
                >
                  <span className="qa-thinking-step__dot" />
                  {index < visibleSteps.length - 1 && (
                    <span className="qa-thinking-step__tail" />
                  )}
                  <div className="text-xs">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`qa-thinking-step__label font-medium ${
                          step.state === "active" ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {step.label}
                      </span>
                      {step.state === "active" && (
                        <span className="inline-flex items-center gap-1" aria-label={`${step.label}进行中`}>
                          <span className="qa-thinking-dot qa-thinking-dot--1" />
                          <span className="qa-thinking-dot qa-thinking-dot--2" />
                          <span className="qa-thinking-dot qa-thinking-dot--3" />
                        </span>
                      )}
                    </div>
                    {step.detail && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {step.detail}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          {showThinkingText ? (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground break-words [overflow-wrap:anywhere]">
              {thinking}
            </p>
          ) : !showStepTimelineBeforeThinking ? (
            <div className="flex items-center gap-2 py-0.5">
              <span className="qa-thinking-bar" />
              {statusMessage && (
                <span className="text-xs text-muted-foreground">{statusMessage}</span>
              )}
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
