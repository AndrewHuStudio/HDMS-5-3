import type { SourceInfo } from "../features/qa/types";
import { normalizeCitationSources } from "./normalize-citation-sources";

export const DEFAULT_THINKING_SECTION_HEADING = "## 思考过程";

interface MergeThinkingArgs {
  answer: string;
  thinking?: string;
  isStreaming?: boolean;
  heading?: string;
}

const FIGURE_MENTION_RE = /[（(]?\s*(?:见)?图\s*([0-9]{1,2}(?:[.\-][0-9]{1,2}){0,3})\s*[)）]?/gu;
const FIGURE_CAPTION_LINE_RE = /^\s*(?:FIGCAPTION\s+)?图\s*\d+(?:[.\-]\d+){0,3}\s*[：:.]/u;
const FIGURE_LEGEND_LINE_RE = /^\s*[（(]?\s*(?:图示|图注|图例)\s*[：:]/u;

function hasImagePayload(source: SourceInfo): boolean {
  return Boolean(
    source.image_url ||
      source.image_name ||
      (source.image_urls && source.image_urls.length > 0) ||
      (source.image_names && source.image_names.length > 0) ||
      (source.image_figures && source.image_figures.length > 0) ||
      (source.image_captions && source.image_captions.length > 0)
  );
}

function mergeImageFields(primary: SourceInfo, fallback: SourceInfo): SourceInfo {
  return {
    ...primary,
    image_url: primary.image_url || fallback.image_url,
    image_name: primary.image_name || fallback.image_name,
    image_urls: (primary.image_urls && primary.image_urls.length > 0) ? primary.image_urls : fallback.image_urls,
    image_names: (primary.image_names && primary.image_names.length > 0) ? primary.image_names : fallback.image_names,
    image_figures: (primary.image_figures && primary.image_figures.length > 0) ? primary.image_figures : fallback.image_figures,
    image_captions: (primary.image_captions && primary.image_captions.length > 0) ? primary.image_captions : fallback.image_captions,
  };
}

function sourceKey(source: SourceInfo, index: number): string {
  const chunkId = source.chunk_id?.trim();
  if (chunkId) return `chunk:${chunkId}`;
  const label = source.citation_label?.trim();
  if (label) return `label:${label}`;
  const docId = source.doc_id?.trim() || "";
  const name = source.name?.trim() || "";
  const section = source.section?.trim() || "";
  return `fallback:${docId}:${name}:${section}:${index}`;
}

export function mergeStreamingSources(
  previousSources: SourceInfo[] | undefined,
  incomingSources: SourceInfo[] | undefined,
): SourceInfo[] {
  const previous = normalizeCitationSources(previousSources ?? []);
  const incoming = normalizeCitationSources(incomingSources ?? []);

  if (incoming.length === 0) {
    return previous;
  }

  const merged: SourceInfo[] = [...incoming];
  const keyToIndex = new Map<string, number>();

  merged.forEach((source, idx) => {
    keyToIndex.set(sourceKey(source, idx), idx);
  });

  previous.forEach((source, idx) => {
    const key = sourceKey(source, idx + merged.length);
    const existingIdx = keyToIndex.get(key);
    if (existingIdx !== undefined) {
      merged[existingIdx] = mergeImageFields(merged[existingIdx], source);
      return;
    }

    keyToIndex.set(key, merged.length);
    merged.push(source);
  });

  return merged;
}

export function mergeThinkingIntoAnswer({ answer, thinking, isStreaming, heading }: MergeThinkingArgs): string {
  const resolvedAnswer = answer || "";
  if (isStreaming) {
    return resolvedAnswer;
  }

  const thinkingText = (thinking || "").trim();
  if (!thinkingText) {
    return resolvedAnswer;
  }

  const sectionHeading = (heading || DEFAULT_THINKING_SECTION_HEADING).trim() || DEFAULT_THINKING_SECTION_HEADING;
  if (resolvedAnswer.includes(sectionHeading) || resolvedAnswer.includes(thinkingText)) {
    return resolvedAnswer;
  }

  const section = `${sectionHeading}\n\n${thinkingText}`;
  return resolvedAnswer.trim() ? `${section}\n\n${resolvedAnswer}` : section;
}

export function collapseFigureMentions(text: string): string {
  if (!text) return text;

  const lines = text.split("\n");
  const out = lines.map((line) => {
    const leadingWhitespaceMatch = line.match(/^(\s*)/u);
    const leadingWhitespace = leadingWhitespaceMatch?.[1] ?? "";
    const trimmed = line.trim();
    if (FIGURE_CAPTION_LINE_RE.test(trimmed) || FIGURE_LEGEND_LINE_RE.test(trimmed)) {
      return line.trimEnd();
    }

    const seenLine = new Set<string>();
    const deduped = line.replace(FIGURE_MENTION_RE, (_raw, figureNum: string) => {
      const normalized = String(figureNum || "").trim();
      if (!normalized) return "";
      if (seenLine.has(normalized)) return "";
      seenLine.add(normalized);
      return `（图${normalized}）`;
    });

    const listMatch = deduped.match(/^(\s*)(?:[-*+]\s+|\d+[.)]\s+)/);
    if (listMatch) {
      const indent = listMatch[1] ?? "";
      const rest = deduped.slice(indent.length);
      const markerMatch = rest.match(/^((?:[-*+]\s+|\d+[.)]\s+))/);
      if (markerMatch) {
        const marker = markerMatch[1] ?? "";
        const body = rest.slice(marker.length);
        return `${indent}${marker}${body}`
          .replace(/[（(]\s*[)）]/g, "")
          .replace(/([^\s])[ \t]{2,}/g, "$1 ")
          .replace(/([，、；;。！？.!?])\s*([，、；;。！？.!?])/g, "$1")
          .trimEnd();
      }
    }

    const normalizedBody = deduped
      .slice(leadingWhitespace.length)
      .replace(/[（(]\s*[)）]/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/([，、；;。！？.!?])\s*([，、；;。！？.!?])/g, "$1")
      .trimEnd();

    return `${leadingWhitespace}${normalizedBody}`;
  });

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
