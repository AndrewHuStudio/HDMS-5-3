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
}

export function ThinkingProcess({ thinking, isStreaming }: ThinkingProcessProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Auto-collapse when streaming ends
  useEffect(() => {
    if (!isStreaming && thinking) {
      setIsOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to streaming state change
  }, [isStreaming]);

  if (!thinking) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-3">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors">
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform duration-200 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <Brain className="h-3 w-3 shrink-0" />
        <span className="font-medium">
          {isStreaming ? "思考中..." : "思考过程"}
        </span>
        {isStreaming && (
          <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-6 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            {thinking}
            {isStreaming && (
              <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-muted-foreground" />
            )}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
