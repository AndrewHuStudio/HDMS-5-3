import { useCallback, useEffect, useId, useRef } from "react";
import type { MouseEvent } from "react";
import type { SourceInfo } from "../../types";
import { cn } from "@/lib/utils";

interface CitationPillProps {
  label: string;
  source?: SourceInfo;
  /** instanceId of the currently hovered pill (not label) */
  activeInstanceId: string | null;
  onHover: (instanceId: string | null) => void;
  onSelect: (label: string) => void;
}

export function CitationPill({
  label,
  source,
  activeInstanceId,
  onHover,
  onSelect,
}: CitationPillProps) {
  const instanceId = useId();
  const isActive = activeInstanceId === instanceId;
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
    onHover(instanceId);
  }, [clearHoverExitTimer, instanceId, onHover]);

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
            : "border-red-400 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20",
        )}
        onFocus={showCitationHover}
        onBlur={hideCitationHover}
        onClick={handleClick}
      >
        {label}
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
