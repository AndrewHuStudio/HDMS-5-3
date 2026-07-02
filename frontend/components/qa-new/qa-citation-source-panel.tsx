"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import type {
  CitationSelection,
  PendingCitationSelection,
} from "@/features/qa/citation-engine";
import type { SourceInfo } from "@/features/qa/types";
import { normalizeCitationSources } from "@/lib/normalize-citation-sources";
import {
  advancePendingCitationSelection,
  buildAnswerCitationAnchorComponent,
  buildCitationSourcePanelScrollerId,
  buildCitationLabelIndexMap,
  createPendingCitationSelection,
  jumpToCitationSource,
  normalizeCitationSelection,
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
  sourceScrollRef?: React.RefObject<HTMLElement | null>;
  sourceTargetsEnabled?: boolean;
  onCitationJump?: (payload: { savedScrollTop: number; originId: string | null }) => void;
}

export interface CitationState {
  sourcesNormalized: SourceInfo[];
  labelIndexMap: Map<string, number>;
  /** instanceId of the currently hovered pill (not citation label) */
  activeInstanceId: string | null;
  activeCitationLabel: string | null;
  setActiveInstanceId: (id: string | null) => void;
  handleCitationSelect: (selection: string | CitationSelection) => void;
  /** Ready-made `a` component override for QAMarkdownRenderer */
  citationAnchorComponent: Components["a"];
}

export function useCitationState({
  sources,
  messageId,
  scrollRef,
  sourceScrollRef,
  sourceTargetsEnabled = false,
  onCitationJump,
}: UseCitationStateArgs): CitationState {
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [activeCitationLabel, setActiveCitationLabel] = useState<string | null>(null);
  const [pendingCitationSelection, setPendingCitationSelection] = useState<PendingCitationSelection | null>(null);

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
    setActiveCitationLabel(null);
    setPendingCitationSelection(null);
  }, [messageId]);

  useEffect(() => {
    if (!activeCitationLabel) return;
    const timeoutId = window.setTimeout(() => {
      setActiveCitationLabel((current) => (current === activeCitationLabel ? null : current));
    }, 1400);
    return () => window.clearTimeout(timeoutId);
  }, [activeCitationLabel]);

  const attemptCitationJump = useCallback((selection: Required<CitationSelection>) => {
    const { label } = selection;
    const chatContainer = scrollRef?.current ?? (document.querySelector(".qa-scrollbar") as HTMLElement | null);
    const sourceScrollerId = buildCitationSourcePanelScrollerId(messageId);
    const sourceContainer = sourceScrollRef?.current?.id === sourceScrollerId
      ? sourceScrollRef.current
      : (document.getElementById(sourceScrollerId) as HTMLElement | null);
    const result = jumpToCitationSource({
      label,
      messageId,
      documentRef: document,
      chatScrollContainer: chatContainer,
      sourceScrollContainer: sourceContainer,
    });
    if (result.found && result.resolvedLabel && result.resolvedLabel !== label) {
      setActiveCitationLabel(result.resolvedLabel);
    }
    return result;
  }, [messageId, scrollRef, sourceScrollRef]);

  const handleCitationSelect = useCallback((selection: string | CitationSelection) => {
    const normalizedSelection = normalizeCitationSelection(selection);
    const { label, originId } = normalizedSelection;
    const chatContainer = scrollRef?.current ?? (document.querySelector(".qa-scrollbar") as HTMLElement | null);
    const savedScrollTop = chatContainer?.scrollTop ?? 0;
    setActiveCitationLabel(label);

    onCitationJump?.({ savedScrollTop, originId });
    requestAnimationFrame(() => {
      const result = attemptCitationJump(normalizedSelection);
      setPendingCitationSelection(
        advancePendingCitationSelection({
          pendingSelection: createPendingCitationSelection(normalizedSelection),
          found: result.found,
          sourceTargetsEnabled,
          maxAttempts: 8,
        }),
      );
    });
  }, [attemptCitationJump, onCitationJump, scrollRef, sourceTargetsEnabled]);

  useEffect(() => {
    if (!pendingCitationSelection || !sourceTargetsEnabled) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const result = attemptCitationJump(pendingCitationSelection);
      setPendingCitationSelection((current) => {
        if (
          !current ||
          current.label !== pendingCitationSelection.label ||
          current.originId !== pendingCitationSelection.originId ||
          current.attempts !== pendingCitationSelection.attempts
        ) {
          return current;
        }

        return advancePendingCitationSelection({
          pendingSelection: current,
          found: result.found,
          sourceTargetsEnabled,
          maxAttempts: 8,
        });
      });
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [attemptCitationJump, pendingCitationSelection, sourceTargetsEnabled]);

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
    activeCitationLabel,
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
  activeCitationLabel?: string | null;
  layout: "inline" | "sidebar";
  className?: string;
  sourceScrollRef?: React.RefObject<HTMLDivElement | null>;
}

export function QACitationSourcePanel({
  sources,
  messageId,
  query,
  activeCitationLabel,
  layout,
  className,
  sourceScrollRef,
}: QACitationSourcePanelProps) {
  if (!sources.length) return null;

  return (
    <aside className={cn(
      layout === "sidebar" ? "self-start xl:sticky xl:top-4" : "mt-2",
      className,
    )}>
      <div
        id={buildCitationSourcePanelScrollerId(messageId)}
        ref={sourceScrollRef}
        className={cn(
          layout === "sidebar" && "max-h-[min(72vh,calc(100vh-9rem))] overflow-y-auto pr-1"
        )}
      >
        <QASources
          sources={sources}
          messageId={messageId}
          query={query}
          selectedCitation={activeCitationLabel}
          layout={layout}
        />
      </div>
    </aside>
  );
}


