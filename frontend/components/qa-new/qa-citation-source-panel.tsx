"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import type { SourceInfo } from "@/features/qa/types";
import { normalizeCitationSources } from "@/lib/normalize-citation-sources";
import {
  buildAnswerCitationAnchorComponent,
  buildCitationLabelIndexMap,
  buildCitationTargetId,
} from "@/features/qa/citation-engine";
import { QASources } from "@/components/qa-sources";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  useCitationState                                                  */
/* ------------------------------------------------------------------ */

interface UseCitationStateArgs {
  sources: SourceInfo[] | undefined;
  messageId: string;
  scrollRef?: React.RefObject<HTMLElement | null>;
  onCitationJump?: (savedScrollTop: number) => void;
}

export interface CitationState {
  sourcesNormalized: SourceInfo[];
  labelIndexMap: Map<string, number>;
  /** instanceId of the currently hovered pill (not citation label) */
  activeInstanceId: string | null;
  setActiveInstanceId: (id: string | null) => void;
  handleCitationSelect: (label: string) => void;
  /** Ready-made `a` component override for QAMarkdownRenderer */
  citationAnchorComponent: Components["a"];
}

export function useCitationState({ sources, messageId, scrollRef, onCitationJump }: UseCitationStateArgs): CitationState {
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);

  const sourcesNormalized = useMemo(
    () => normalizeCitationSources(sources ?? []),
    [sources],
  );

  const labelIndexMap = useMemo(
    () => buildCitationLabelIndexMap(sourcesNormalized),
    [sourcesNormalized],
  );

  // Reset on message change
  useEffect(() => {
    setActiveInstanceId(null);
  }, [messageId]);

  const handleCitationSelect = useCallback((label: string) => {
    const container = scrollRef?.current ?? (document.querySelector(".qa-scrollbar") as HTMLElement | null);
    if (!container) return;
    const savedScrollTop = container.scrollTop;

    // Try exact ID first, then fallback to doc-level label (e.g. "1-1" → "1")
    const exactId = buildCitationTargetId(label, messageId);
    let target = document.getElementById(exactId);
    if (!target) {
      const docLabel = label.split("-")[0];
      target = document.getElementById(buildCitationTargetId(docLabel, messageId));
    }
    if (!target) return;

    // Calculate target's offset relative to the scroll container
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetOffsetInContainer = targetRect.top - containerRect.top + container.scrollTop;
    // Center the target in the container
    const scrollTo = targetOffsetInContainer - container.clientHeight / 2 + target.offsetHeight / 2;

    onCitationJump?.(savedScrollTop);
    container.scrollTo({ top: scrollTo, behavior: "smooth" });
    target.classList.add("qa-source-flash");
    setTimeout(() => target.classList.remove("qa-source-flash"), 1200);
  }, [messageId, scrollRef, onCitationJump]);

  const citationAnchorComponent: Components["a"] = useMemo(
    () =>
      buildAnswerCitationAnchorComponent({
        sources: sourcesNormalized,
        labelIndexMap,
        messageId,
        activeInstanceId,
        onCitationHover: setActiveInstanceId,
        onCitationSelect: handleCitationSelect,
      }),
    [sourcesNormalized, labelIndexMap, messageId, activeInstanceId, handleCitationSelect],
  );

  return {
    sourcesNormalized,
    labelIndexMap,
    activeInstanceId,
    setActiveInstanceId,
    handleCitationSelect,
    citationAnchorComponent,
  };
}

/* ------------------------------------------------------------------ */
/*  QACitationSourcePanel                                             */
/* ------------------------------------------------------------------ */

interface QACitationSourcePanelProps {
  sources: SourceInfo[];
  messageId: string;
  query?: string;
  onCitationSelect: (label: string) => void;
  layout: "inline" | "sidebar";
  className?: string;
}

export function QACitationSourcePanel({
  sources,
  messageId,
  query,
  onCitationSelect,
  layout,
  className,
}: QACitationSourcePanelProps) {
  if (!sources.length) return null;

  return (
    <aside className={cn(
      layout === "sidebar" ? "self-start xl:sticky xl:top-4" : "mt-2",
      className,
    )}>
      <QASources
        sources={sources}
        messageId={messageId}
        query={query}
        onCitationSelect={onCitationSelect}
        layout={layout}
      />
    </aside>
  );
}


