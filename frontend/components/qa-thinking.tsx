"use client";

import { useState, useEffect } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronRight, Brain } from "lucide-react";

interface ThinkingProcessProps {
  thinking: string;
  isStreaming: boolean;
  statusMessage?: string;
}

export function ThinkingProcess({ thinking, isStreaming, statusMessage }: ThinkingProcessProps) {
  const [isOpen, setIsOpen] = useState(true);
  const hasThinking = Boolean(thinking.trim());

  // Auto-collapse when streaming ends.
  useEffect(() => {
    if (!isStreaming && hasThinking) {
      setIsOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to streaming state change
  }, [isStreaming]);

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
        <span className="font-medium">{isStreaming ? "思考中" : "思考过程"}</span>
        {isStreaming && (
          <span className="ml-1 inline-flex items-center gap-1" aria-label="思考中">
            <span className="qa-thinking-dot qa-thinking-dot--1" />
            <span className="qa-thinking-dot qa-thinking-dot--2" />
            <span className="qa-thinking-dot qa-thinking-dot--3" />
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-5 border-l border-border/70 pl-3">
          {hasThinking ? (
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
