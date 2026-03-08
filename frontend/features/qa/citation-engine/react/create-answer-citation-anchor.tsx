import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import type { SourceInfo } from "../../types";
import { CitationLink } from "./citation-link";

interface BuildAnswerCitationAnchorArgs {
  sources: SourceInfo[];
  labelIndexMap: Map<string, number>;
  activeInstanceId: string | null;
  onCitationHover: (instanceId: string | null) => void;
  onCitationSelect: (label: string) => void;
}

export function buildAnswerCitationAnchorComponent(
  args: BuildAnswerCitationAnchorArgs,
): Components["a"] {
  const {
    sources,
    labelIndexMap,
    activeInstanceId,
    onCitationHover,
    onCitationSelect,
  } = args;

  const AnchorComponent = ({ href, children }: { href?: string; children?: ReactNode }) => (
    <CitationLink
      href={href}
      sources={sources}
      labelIndexMap={labelIndexMap}
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

