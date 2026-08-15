import assert from "node:assert/strict";
import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";
import type { SourceInfo } from "../features/qa/types";

const sources: SourceInfo[] = [
  {
    type: "document",
    name: "医院建筑设计指南.pdf",
    source: "vector_search",
    citation_label: "2-1",
    doc_id: "doc-hospital-guide",
    chunk_id: "chunk-image-1",
    image_urls: [
      "/api/rag/documents/doc-hospital-guide/image?ref=images/outpatient-layout.png",
    ],
    image_names: ["outpatient-layout.png"],
    image_figures: ["图5.2.2"],
    image_captions: ["图5.2.2 门诊空间组织示意图"],
  },
];

const markdown = buildAnswerMarkdown({
  content: "门诊空间需要组织清晰、流线分明，并兼顾候诊与导诊效率。[2-1]",
  sources,
  isStreaming: false,
  renderPhase: "final",
  precedingQuestion: "请返回门诊空间设计相关图片",
});

assert.match(
  markdown,
  /### 相关配图/u,
  `expected image-intent answer to include related image appendix, got:\n${markdown}`,
);
assert.match(
  markdown,
  /!\[[^\]]*门诊空间组织示意图[^\]]*\]\(\/api\/rag\/documents\/doc-hospital-guide\/image\?ref=images\/outpatient-layout\.png\)/u,
  `expected appendix to render source image markdown, got:\n${markdown}`,
);

console.log("qa-image-intent-appendix-regression passed");

export {};
