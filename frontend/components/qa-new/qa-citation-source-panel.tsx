"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import type { SourceInfo } from "@/features/qa/types";
import { normalizeCitationSources } from "@/lib/normalize-citation-sources";
import {
  buildCitationLabelIndexMap,
  CitationLink,
} from "@/features/qa/citations";
import { QASources } from "@/components/qa-sources";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  useCitationState                                                  */
/* ------------------------------------------------------------------ */

interface UseCitationStateArgs {
  sources: SourceInfo[] | undefined;
  messageId: string;
}

export interface CitationState {
  sourcesNormalized: SourceInfo[];
  labelIndexMap: Map<string, number>;
  activeCitationLabel: string | null;
  setActiveCitationLabel: (label: string | null) => void;
  handleCitationSelect: (label: string) => void;
  /** Ready-made `a` component override for QAMarkdownRenderer */
  citationAnchorComponent: Components["a"];
}

export function useCitationState({ sources, messageId }: UseCitationStateArgs): CitationState {
  const [activeCitationLabel, setActiveCitationLabel] = useState<string | null>(null);

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
    setActiveCitationLabel(null);
  }, [messageId]);

  const handleCitationSelect = useCallback((label: string) => {
    setActiveCitationLabel(label);
    const target = document.getElementById(`source-${label}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("qa-source-flash");
      setTimeout(() => target.classList.remove("qa-source-flash"), 1200);
    }
  }, []);

  const citationAnchorComponent: Components["a"] = useMemo(() => {
    const AnchorComponent = ({ href, children }: { href?: string; children?: ReactNode }) => (
      <CitationLink
        href={href}
        sources={sourcesNormalized}
        labelIndexMap={labelIndexMap}
        activeCitationLabel={activeCitationLabel}
        onCitationHover={setActiveCitationLabel}
        onCitationSelect={handleCitationSelect}
      >
        {children}
      </CitationLink>
    );
    AnchorComponent.displayName = "CitationAnchor";
    return AnchorComponent;
  }, [sourcesNormalized, labelIndexMap, activeCitationLabel, handleCitationSelect]);

  return {
    sourcesNormalized,
    labelIndexMap,
    activeCitationLabel,
    setActiveCitationLabel,
    handleCitationSelect,
    citationAnchorComponent,
  };
}

/* ------------------------------------------------------------------ */
/*  QACitationSourcePanel                                             */
/* ------------------------------------------------------------------ */

interface QACitationSourcePanelProps {
  sources: SourceInfo[];
  query?: string;
  activeCitation: string | null;
  onCitationHover: (label: string | null) => void;
  onCitationSelect: (label: string) => void;
  layout: "inline" | "sidebar";
  className?: string;
}

export function QACitationSourcePanel({
  sources,
  query,
  activeCitation,
  onCitationHover,
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
        query={query}
        activeCitation={activeCitation}
        onCitationHover={onCitationHover}
        onCitationSelect={onCitationSelect}
        layout={layout}
      />
    </aside>
  );
}
