"use client";

import { Building2, ChevronRight, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QAConversationToolbarProps {
  historyOpen: boolean;
  onToggleHistory: () => void;
}

export function QAConversationToolbar({
  historyOpen,
  onToggleHistory,
}: QAConversationToolbarProps) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Building2 className="h-4 w-4" />
        </div>
        <p className="truncate text-sm font-semibold">管控问答助手</p>
      </div>

      <Button
        type="button"
        size="sm"
        className={cn(
          "h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs",
          historyOpen && "shadow-sm"
        )}
        onClick={onToggleHistory}
        aria-pressed={historyOpen}
      >
        <History className="h-3.5 w-3.5" />
        历史对话
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", historyOpen && "rotate-180")} />
      </Button>
    </div>
  );
}
