import type { SourceInfo } from "../../types";
import { collectValidCitationLabels } from "./citation-utils";
import { convertCitationsToAnchors } from "./convert-citations-to-anchors";
import { convertCircledCitationsToAnchors } from "./convert-circled-citations-to-anchors";
import { normalizeCitations } from "./normalize-citations";
import { stripInlineCitationLabels } from "./strip-inline-citation-labels";

interface ProcessAnswerCitationsArgs {
  text: string;
  sources: SourceInfo[];
  isStreaming?: boolean;
}

/**
 * Keep answer-body citation processing in one place so renderers can stay thin.
 */
export function processAnswerCitations(args: ProcessAnswerCitationsArgs): string {
  const { text, sources, isStreaming } = args;
  if (!text) return text;

  const streaming = Boolean(isStreaming);
  const normalized = streaming ? text : normalizeCitations(text, sources);
  const withAnchors = streaming
    ? normalized
    : convertCitationsToAnchors(normalized, collectValidCitationLabels(sources));
  const withCircledFallback = streaming
    ? withAnchors
    : convertCircledCitationsToAnchors(withAnchors, sources);

  return stripInlineCitationLabels(withCircledFallback);
}
