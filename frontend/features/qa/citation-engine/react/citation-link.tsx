import React from "react";
import type { ReactNode } from "react";
import type { SourceInfo } from "../../types";
import type { CitationSelection } from "../core";
import { CitationPill } from "./citation-pill";
import { parseCitationLabelFromHref } from "../core/citation-utils";

interface CitationLinkProps {
  href?: string;
  children: ReactNode;
  sources: SourceInfo[];
  labelIndexMap: Map<string, number>;
  messageId?: string;
  activeInstanceId: string | null;
  onCitationHover: (instanceId: string | null) => void;
  onCitationSelect: (selection: CitationSelection) => void;
}

export function CitationLink({
  href,
  children,
  sources,
  labelIndexMap,
  messageId,
  activeInstanceId,
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
        messageId={messageId}
        activeInstanceId={activeInstanceId}
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
