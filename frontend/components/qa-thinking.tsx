/**
 * QA 思考过程展示组件
 * 显示 AI 助手的思考过程（thinking），支持折叠/展开、流式更新、自动收起等功能。
 */
"use client";

import { useEffect, useRef, useState } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronRight, Brain } from "lucide-react";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { resolveThinkingHeaderState } from "./qa-thinking-status";
import { getThinkingEllipsisDots } from "./qa-thinking-ellipsis";
import {
  resolveThinkingFinishedState,
  shouldAutoCollapseThinking,
} from "./qa-thinking-collapse";

interface ThinkingProcessProps {
  thinking: string;
  isStreaming: boolean;
  thinkingDone?: boolean;
}

export function ThinkingProcess({
  thinking,
  isStreaming,
  thinkingDone,
}: ThinkingProcessProps) {
  const [isOpen, setIsOpen] = useState(true);
  const hasThinking = Boolean(thinking.trim());
  const headerState = resolveThinkingHeaderState({
    isStreaming,
    thinkingDone,
    hasThinkingTokens: hasThinking,
  });
  const showThinkingAnimation = headerState === "thinking";
  const showThinkingResult = headerState === "history" && hasThinking;
  const ellipsisDots = getThinkingEllipsisDots();
  const thinkingFinished = resolveThinkingFinishedState({
    hasThinkingTokens: hasThinking,
    isStreaming,
    thinkingDone,
  });
  const previousThinkingFinishedRef = useRef(thinkingFinished);

  useEffect(() => {
    if (shouldAutoCollapseThinking(previousThinkingFinishedRef.current, thinkingFinished)) {
      setIsOpen(false);
    }
    previousThinkingFinishedRef.current = thinkingFinished;
  }, [thinkingFinished]);

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
        {showThinkingAnimation ? (
          <span className="inline-flex items-center">
            <TextShimmer
              as="span"
              duration={1.15}
              className="text-xs font-medium [--base-color:color-mix(in_oklab,var(--muted-foreground)_70%,var(--foreground)_30%)] [--base-gradient-color:var(--foreground)]"
            >
              思考中
            </TextShimmer>
            <span aria-hidden="true" className="ml-0.5 inline-flex gap-0.5">
              {ellipsisDots.map((dot, index) => (
                <span
                  key={`${dot}-${index}`}
                  className={`qa-thinking-ellipsis-dot qa-thinking-ellipsis-dot--${index + 1}`}
                >
                  {dot}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span className="font-medium text-foreground">思考过程</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {showThinkingResult ? (
          <div className="mt-1 ml-2.5 border-l border-border/70 pl-3">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground break-words [overflow-wrap:anywhere]">
              {thinking}
            </p>
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
