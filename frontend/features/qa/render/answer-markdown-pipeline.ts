/**
 * 答案 Markdown 构建管线
 * 按阶段依次执行：表格规范化 → Markdown 规范化 → 引用处理 → 图片注入 → 表格注入 → 图注折叠。
 * buildAnswerMarkdown: 根据 renderPhase 选择合适的处理深度，避免流式阶段的视觉抖动。
 */
import { processAnswerCitations } from "@/features/qa/citation-engine";
import type { SourceInfo } from "@/features/qa/types";
import type { AnswerRenderPhase } from "@/features/qa/render/assistant-render-state-machine";
import { injectSourceTables } from "@/lib/inject-source-tables";
import { normalizeAnswerTables } from "@/lib/normalize-answer-tables";
import { collapseFigureMentions } from "@/lib/stream-source-utils";
import { injectAnswerImagesByPhase } from "@/features/qa/render/image-injection-pipeline";
import { normalizeAnswerMarkdownByPhase } from "@/features/qa/render/markdown-normalization-pipeline";

const MARKDOWN_IMAGE_DEST_RE = /!\[[^\]]*\]\(([^)\n]+)\)/g;
const HTML_IMAGE_SRC_RE = /<img\b[^>]*\bsrc=(['"])([^'"]+)\1/gi;
const RAG_IMAGE_ROUTE_RE = /^\/(?:api\/)?rag\/documents\/[^/?#]+\/image$/i;
const STRUCTURED_IMG_ANCHOR_RE = /\[\[\s*IMG\s*:\s*\d{1,2}-\d{1,2}(?:#\d{1,2})?\s*\]\]/i;
const GFM_TABLE_RE = /\|.+\|\n\s*\|?\s*:?-{3,}:?/m;

export interface BuildAnswerMarkdownArgs {
  content: string;
  sources: SourceInfo[];
  isStreaming: boolean;
  renderPhase?: AnswerRenderPhase;
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

/**
 * During streaming, hide trailing incomplete GFM table fragments.
 * A table is "incomplete" if it has pipe-delimited rows at the end
 * but no separator row (|---|---|) following the header.
 */
function stripTrailingIncompleteTable(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  // Walk backwards to find trailing pipe-heavy lines without a separator
  let trailingPipeStart = -1;
  let hasSeparator = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const pipeCount = (trimmed.match(/\|/g) || []).length;
    if (pipeCount >= 2 && /^\|/.test(trimmed)) {
      if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(trimmed)) {
        hasSeparator = true;
      }
      trailingPipeStart = i;
    } else {
      break;
    }
  }
  // If we found trailing pipe lines but no separator, they're an incomplete table
  if (trailingPipeStart >= 0 && !hasSeparator) {
    return lines.slice(0, trailingPipeStart).join("\n");
  }
  return text;
}

export function buildAnswerMarkdown(args: BuildAnswerMarkdownArgs): string {
  const {
    content,
    sources,
    isStreaming,
    renderPhase,
    precedingQuestion,
    finalizedByServer,
  } = args;
  const phase: AnswerRenderPhase = renderPhase || (isStreaming ? "streaming" : "final");
  const streamLike = phase === "streaming";
  const withTables = normalizeAnswerTables(content);
  const withArtifacts = normalizeAnswerMarkdownByPhase({
    content: withTables,
    renderPhase: phase,
  });
  const withoutInlineCitations = processAnswerCitations({
    text: withArtifacts,
    sources,
    isStreaming: streamLike,
  });

  if (phase !== "final") {
    // During streaming, strip trailing incomplete table to prevent raw pipe text flash
    const safeContent = streamLike
      ? stripTrailingIncompleteTable(withoutInlineCitations)
      : withoutInlineCitations;
    const withPhaseImages = injectAnswerImagesByPhase({
      markdown: safeContent,
      sources,
      precedingQuestion,
      renderPhase: phase,
    });
    return collapseFigureMentions(withPhaseImages);
  }

  const renderableImageCount = countRenderableMarkdownImages(withoutInlineCitations);
  const hasRenderableMarkdownImage = renderableImageCount > 0;
  const hasStructuredImageAnchor = STRUCTURED_IMG_ANCHOR_RE.test(withoutInlineCitations);
  const hasGfmTable = GFM_TABLE_RE.test(withoutInlineCitations);

  const shouldInjectImages = hasStructuredImageAnchor || !hasRenderableMarkdownImage;
  const shouldInjectTables = !finalizedByServer || !hasGfmTable;

  const withImages = shouldInjectImages
    ? injectAnswerImagesByPhase({
      markdown: withoutInlineCitations,
      sources,
      precedingQuestion,
      renderPhase: "final",
    })
    : withoutInlineCitations;
  const withTablesAndImages = shouldInjectTables
    ? injectSourceTables(withImages, sources)
    : withImages;
  return collapseFigureMentions(withTablesAndImages);
}

