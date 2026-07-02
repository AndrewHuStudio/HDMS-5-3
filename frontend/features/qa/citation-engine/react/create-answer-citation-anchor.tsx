import React from "react";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import type { SourceInfo } from "../../types";
import type { CitationSelection } from "../core";
import { CitationLink } from "./citation-link";

interface BuildAnswerCitationAnchorArgs {
  sources: SourceInfo[];
  labelIndexMap: Map<string, number>;
  messageId?: string;
  activeInstanceId: string | null;
  onCitationHover: (instanceId: string | null) => void;
  onCitationSelect: (selection: CitationSelection) => void;
}

export function buildAnswerCitationAnchorComponent(
  args: BuildAnswerCitationAnchorArgs,
): Components["a"] {
  const {
    sources,
    labelIndexMap,
    messageId,
    activeInstanceId,
    onCitationHover,
    onCitationSelect,
  } = args;

  const AnchorComponent = ({ href, children }: { href?: string; children?: ReactNode }) => (
    <CitationLink
      href={href}
      sources={sources}
      labelIndexMap={labelIndexMap}
      messageId={messageId}
      activeInstanceId={activeInstanceId}
      onCitationHover={onCitationHover}
      onCitationSelect={onCitationSelect}
    >
      {children}
    </CitationLink>
  );
  AnchorComponent.displayName = "AnswerCitationAnchor";
  return AnchorComponent;
}
