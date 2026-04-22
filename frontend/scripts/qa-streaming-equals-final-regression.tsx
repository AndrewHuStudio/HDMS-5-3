/**
 * Regression: 输出过程即结果
 * Guarantees buildAnswerMarkdown(streaming) === buildAnswerMarkdown(final)
 * for identical content + identical sources, covering:
 *   - citation normalization (streaming/final unified)
 *   - image injection (streaming/final unified, no appendix fallback)
 *   - markdown normalization (streaming/final unified)
 *   - table injection
 */
import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";
import type { SourceInfo } from "../features/qa/types";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function diffFirst(a: string, b: string): string {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const out: string[] = [];
  for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
    if (aLines[i] !== bLines[i]) {
      out.push(`line ${i}:`);
      out.push(`  streaming: ${JSON.stringify(aLines[i])}`);
      out.push(`  final:     ${JSON.stringify(bLines[i])}`);
      if (out.length >= 12) break;
    }
  }
  return out.join("\n");
}

const sources: SourceInfo[] = [
  {
    type: "vector",
    name: "示范文档.pdf",
    source: "示范文档.pdf",
    citation_label: "1-1",
    doc_id: "demo",
    chunk_id: "c-1-1",
    chunk_index: 1,
    score: 0.9,
    image_url: "/api/rag/documents/demo/image?ref=a.png",
    image_name: "a.png",
    image_figures: ["图1"],
    image_captions: ["参考配图1"],
  },
  {
    type: "vector",
    name: "示范文档.pdf",
    source: "示范文档.pdf",
    citation_label: "1-3",
    doc_id: "demo",
    chunk_id: "c-1-3",
    chunk_index: 3,
    score: 0.8,
    image_url: "/api/rag/documents/demo/image?ref=b.png",
    image_name: "b.png",
    image_figures: ["图2"],
    image_captions: ["参考配图2"],
  },
];

const scenarios = [
  {
    name: "image + table + citation mix",
    content: `一、总体规划
内容[1-1]。

![示意图](/api/rag/documents/demo/image?ref=a.png)

FIGCAPTION 图1：示意图[1-1]

| 维度 | 管控要点 |
| --- | --- |
| 功能复合 | 商业、办公混合布局[1-3]。 |

二、详细分析
- 要点一[1-1]
- 要点二[1-3]`,
  },
  {
    name: "citation only (no images)",
    content: `说明 A[1-1]。

说明 B[1-3]。`,
  },
  {
    name: "table only",
    content: `| 指标 | 值 |
| --- | --- |
| 容积率 | 3.5 |
| 绿地率 | 30% |`,
  },
  {
    name: "mixed list normalization",
    content: `- 要点 A
1. 要点 B
- 要点 C`,
  },
];

for (const sc of scenarios) {
  const streaming = buildAnswerMarkdown({
    content: sc.content,
    sources,
    isStreaming: true,
    renderPhase: "streaming",
    precedingQuestion: "规划说明?",
  });
  const final_ = buildAnswerMarkdown({
    content: sc.content,
    sources,
    isStreaming: false,
    renderPhase: "final",
    precedingQuestion: "规划说明?",
  });
  assert(
    streaming === final_,
    `streaming !== final for scenario "${sc.name}".\n${diffFirst(streaming, final_)}`,
  );
}

// Explicit anti-regression: streaming output must NOT contain an image
// that doesn't appear in the final output (and vice versa).
// This catches the "appendix fallback" bug from the plan.
for (const sc of scenarios) {
  const streaming = buildAnswerMarkdown({
    content: sc.content, sources, isStreaming: true, renderPhase: "streaming",
  });
  const final_ = buildAnswerMarkdown({
    content: sc.content, sources, isStreaming: false, renderPhase: "final",
  });
  const streamingImages = (streaming.match(/!\[[^\]]*\]\([^)]+\)/g) || []).sort();
  const finalImages = (final_.match(/!\[[^\]]*\]\([^)]+\)/g) || []).sort();
  assert(
    JSON.stringify(streamingImages) === JSON.stringify(finalImages),
    `image set differs between streaming and final for "${sc.name}":\n  streaming: ${JSON.stringify(streamingImages)}\n  final:     ${JSON.stringify(finalImages)}`,
  );
}

console.log("qa-streaming-equals-final-regression passed");
