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
  const understandingStartRef = useRef<number>(Date.now());
  const UNDERSTANDING_MIN_MS = 1500;

  useEffect(() => {
    if (!isStreaming) {
      if (stageTimerRef.current) {
        clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }
      return;
    }
    if (!statusStage || statusStage === "understanding") {
      understandingStartRef.current = Date.now();
    }
  }, [isStreaming, statusStage]);

  useEffect(() => {
    if (!isStreaming || hasThinking) {
      if (stageTimerRef.current) {
        clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }
      return;
    }

    const targetStage = statusStage || "understanding";
    if (targetStage === displayStage) return;

    if (displayStage === "understanding" && targetStage !== "understanding") {
      const elapsed = Date.now() - understandingStartRef.current;
      const remaining = UNDERSTANDING_MIN_MS - elapsed;
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
    }

    setDisplayStage(targetStage);
  }, [displayStage, hasThinking, isStreaming, statusStage]);

  useEffect(() => {
    return () => {
      if (stageTimerRef.current) {
        clearTimeout(stageTimerRef.current);
      }
    };
  }, []);

  const showStepTimeline = isStreaming && !hasThinking;
  const steps = buildThinkingSteps({
    stage: displayStage,
    statusMessage,
    retrievalStats,
  });
  const activeIndex = steps.findIndex((step) => step.state === "active");
  const visibleCount = Math.max(1, activeIndex + 1);
  const visibleSteps = steps.slice(0, visibleCount);

  // Thinking is actively in progress only when streaming and not yet done.
  const isThinkingActive = isStreaming && !thinkingDone;

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
        <div className="mt-1 ml-5 border-l border-border/70 pl-3">
          {showStepTimeline ? (
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
                  <div className="flex items-center gap-1.5 text-xs">
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
                </li>
              ))}
            </ol>
          ) : hasThinking ? (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground break-words [overflow-wrap:anywhere]">
              {thinking}
            </p>
          ) : (
            <div className="flex items-center gap-2 py-0.5">
              <span className="qa-thinking-bar" />
              {statusMessage && (
                <span className="text-xs text-muted-foreground">{statusMessage}</span>
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
