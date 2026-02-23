import { processAnswerCitations } from "@/features/qa/citations";
import type { SourceInfo } from "@/features/qa/types";
import { injectSourceImages } from "@/lib/inject-source-images";
import { injectSourceTables } from "@/lib/inject-source-tables";
import { normalizeAnswerMarkdownArtifacts } from "@/lib/normalize-answer-markdown-artifacts";
import { normalizeAnswerTables } from "@/lib/normalize-answer-tables";
import { collapseFigureMentions } from "@/lib/stream-source-utils";

const MARKDOWN_IMAGE_DEST_RE = /!\[[^\]]*\]\(([^)\n]+)\)/g;
const HTML_IMAGE_SRC_RE = /<img\b[^>]*\bsrc=(['"])([^'"]+)\1/gi;
const RAG_IMAGE_ROUTE_RE = /^\/(?:api\/)?rag\/documents\/[^/?#]+\/image$/i;
const STRUCTURED_IMG_ANCHOR_RE = /\[\[\s*IMG\s*:\s*\d{1,2}-\d{1,2}(?:#\d{1,2})?\s*\]\]/i;
const GFM_TABLE_RE = /\|.+\|\n\s*\|?\s*:?-{3,}:?/m;

export interface BuildAnswerMarkdownArgs {
  content: string;
  sources: SourceInfo[];
  isStreaming: boolean;
  precedingQuestion?: string;
  finalizedByServer?: boolean;
}

function parseMarkdownImageDestination(raw: string): string {
  let cleaned = String(raw || "").trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("<") && cleaned.endsWith(">")) {
    cleaned = cleaned.slice(1, -1).trim();
  } else {
    const titleMatch = cleaned.match(/^(.*?)(?:\s+["'][^"']*["'])\s*$/);
    if (titleMatch?.[1]) cleaned = titleMatch[1].trim();
  }
  return cleaned.replace(/\\ /g, " ").replace(/\\\\/g, "\\").trim();
}

function isRenderableMarkdownImageUrl(raw: string): boolean {
  const url = String(raw || "").trim();
  if (!url) return false;
  if (/^(?:https?:\/\/|data:)/i.test(url)) return true;
  if (!(url.startsWith("/rag/") || url.startsWith("/api/rag/"))) return false;
  try {
    const parsed = new URL(url, "http://localhost");
    if (!RAG_IMAGE_ROUTE_RE.test(parsed.pathname)) return true;
    return Boolean((parsed.searchParams.get("ref") || "").trim());
  } catch {
    return false;
  }
}

function countRenderableMarkdownImages(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const match of text.matchAll(MARKDOWN_IMAGE_DEST_RE)) {
    const dest = parseMarkdownImageDestination(match[1] || "");
    if (isRenderableMarkdownImageUrl(dest)) count += 1;
  }
  for (const match of text.matchAll(HTML_IMAGE_SRC_RE)) {
    const src = String(match[2] || "").trim();
    if (isRenderableMarkdownImageUrl(src)) count += 1;
  }
  return count;
}

export function buildAnswerMarkdown(args: BuildAnswerMarkdownArgs): string {
  const {
    content,
    sources,
    isStreaming,
    precedingQuestion,
    finalizedByServer,
  } = args;
  const withTables = normalizeAnswerTables(content);
  const withArtifacts = normalizeAnswerMarkdownArtifacts(withTables, {
    streaming: isStreaming,
  });
  const withoutInlineCitations = processAnswerCitations({
    text: withArtifacts,
    sources,
    isStreaming,
  });

  if (isStreaming) {
    const withStreamingImages = injectSourceImages(
      withoutInlineCitations,
      sources,
      precedingQuestion,
      { streaming: true, allowAppendixFallback: true },
    );
    return collapseFigureMentions(withStreamingImages);
  }

  const renderableImageCount = countRenderableMarkdownImages(withoutInlineCitations);
  const hasRenderableMarkdownImage = renderableImageCount > 0;
  const hasStructuredImageAnchor = STRUCTURED_IMG_ANCHOR_RE.test(withoutInlineCitations);
  const hasGfmTable = GFM_TABLE_RE.test(withoutInlineCitations);

  const shouldInjectImages = hasStructuredImageAnchor || !hasRenderableMarkdownImage;
  const shouldInjectTables = !finalizedByServer || !hasGfmTable;

  const withImages = shouldInjectImages
    ? injectSourceImages(withoutInlineCitations, sources, precedingQuestion)
    : withoutInlineCitations;
  const withTablesAndImages = shouldInjectTables
    ? injectSourceTables(withImages, sources)
    : withImages;
  return collapseFigureMentions(withTablesAndImages);
}

