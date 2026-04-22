/**
 * 答案 Markdown 构建管线
 * 统一管线：表格规范化 → Markdown 规范化 → 引用处理 → 图片注入 → 表格注入 → 图注折叠。
 * 所有阶段走同一条路径，保证"输出过程即结果"。
 */
import { processAnswerCitations } from "@/features/qa/citation-engine";
import type { SourceInfo } from "@/features/qa/types";
import type { AnswerRenderPhase } from "@/features/qa/render/assistant-render-state-machine";
import { injectSourceTables } from "@/lib/inject-source-tables";
import { normalizeAnswerTables } from "@/lib/normalize-answer-tables";
import { collapseFigureMentions } from "@/lib/stream-source-utils";
import { injectAnswerImagesByPhase } from "@/features/qa/render/image-injection-pipeline";
import { normalizeAnswerMarkdownByPhase } from "@/features/qa/render/markdown-normalization-pipeline";

export interface BuildAnswerMarkdownArgs {
  content: string;
  sources: SourceInfo[];
  isStreaming: boolean;
  renderPhase?: AnswerRenderPhase;
  precedingQuestion?: string;
  finalizedByServer?: boolean;
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
  } = args;
  const phase: AnswerRenderPhase = renderPhase || (isStreaming ? "streaming" : "final");
  const streamLike = phase === "streaming";

  // Step 1: Table normalization
  const withTables = normalizeAnswerTables(content);

  // Step 2: Markdown normalization (phase-aware for safety rules only)
  const withArtifacts = normalizeAnswerMarkdownByPhase({
    content: withTables,
    renderPhase: phase,
  });

  // Step 3: Citation processing (unified — no streaming/final difference)
  const withoutInlineCitations = processAnswerCitations({
    text: withArtifacts,
    sources,
    isStreaming: false,
  });

  // Step 4: Strip trailing incomplete table during streaming only
  // (safe: complete content won't have incomplete trailing tables)
  const safeContent = streamLike
    ? stripTrailingIncompleteTable(withoutInlineCitations)
    : withoutInlineCitations;

  // Step 5: Image injection (unified — no appendix, no placeholder replacement)
  const withImages = injectAnswerImagesByPhase({
    markdown: safeContent,
    sources,
    precedingQuestion,
    renderPhase: phase,
  });

  // Step 6: Table injection from sources
  const withTablesAndImages = injectSourceTables(withImages, sources);

  // Step 7: Collapse figure mentions
  return collapseFigureMentions(withTablesAndImages);
}
