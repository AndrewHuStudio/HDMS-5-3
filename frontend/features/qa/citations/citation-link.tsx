import type { ReactNode } from "react";
import type { SourceInfo } from "../types";
import { CitationPill } from "./citation-pill";
import { parseCitationLabelFromHref } from "./citation-utils";

interface CitationLinkProps {
  href?: string;
  children: ReactNode;
  sources: SourceInfo[];
  labelIndexMap: Map<string, number>;
  activeCitationLabel: string | null;
  onCitationHover: (label: string | null) => void;
  onCitationSelect: (label: string) => void;
}

export function CitationLink({
  href,
  children,
  sources,
  labelIndexMap,
  activeCitationLabel,
  onCitationHover,
  onCitationSelect,
}: CitationLinkProps) {
  const citationLabel = parseCitationLabelFromHref(href);
  if (citationLabel !== null) {
    const sourceIdx = labelIndexMap.get(citationLabel);
    const source = sourceIdx !== undefined ? sources[sourceIdx] : undefined;
    return (
      <CitationPill
        label={citationLabel}
        source={source}
        isActive={activeCitationLabel === citationLabel}
        onHover={onCitationHover}
        onSelect={onCitationSelect}
      />
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline"
    >
      {children}
    </a>
  );
}

