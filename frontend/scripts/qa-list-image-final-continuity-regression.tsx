import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";
import { QAMarkdownRenderer } from "../components/qa-new/qa-markdown-renderer";
import type { SourceInfo } from "../features/qa/types";

const sources: SourceInfo[] = [
  {
    type: "vector",
    source: "vector",
    citation_label: "1-4",
    name: "参考配图",
    image_url: "/api/rag/documents/demo/image?ref=grid.png",
    image_name: "参考配图",
    image_figures: ["图1"],
    image_captions: ["参考范围图"],
  },
  {
    type: "vector",
    source: "vector",
    citation_label: "1-5",
    name: "场所剖示图",
  },
];

const content = `## 三、规划实施特点

1. **立体分层开发** 通过（图1）可见多功能空间（商业/交通/设备）的垂直叠合，实现土地集约利用。[1-4]

1. **公共空间锚点** 场所剖示图[1-5]显示下沉广场、中庭等节点作为活力核心，引导人流聚集。
1. **弹性预留控制** 地下二/三层图纸中未填色区域为远期预留空间，体现动态发展考量。`;

const markdown = buildAnswerMarkdown({
  content,
  sources,
  isStreaming: false,
  renderPhase: "final",
});

assert.match(
  markdown,
  /\n\s{3}!\[参考范围图\]\([^)]+\)\n/u,
  `expected injected image to remain indented inside the first ordered list item, got:\n${markdown}`,
);

assert.match(
  markdown,
  /\n\s{3}FIGCAPTION 图1：参考范围图\n/u,
  `expected injected figure caption to remain indented inside the first ordered list item, got:\n${markdown}`,
);

const html = renderToStaticMarkup(<QAMarkdownRenderer markdown={markdown} />);
const orderedListCount = (html.match(/<ol(?:\s|>)/g) || []).length;
const listItemCount = (html.match(/<li[^>]*>/g) || []).length;
const compact = html.replace(/\s+/g, " ");

assert.equal(
  orderedListCount,
  1,
  `expected a single ordered list after final pipeline processing, got ${orderedListCount}:\n${html}`,
);

assert.equal(
  listItemCount,
  3,
  `expected three ordered list items after final pipeline processing, got ${listItemCount}:\n${html}`,
);

assert.match(
  compact,
  /<ol[^>]*>\s*<li[^>]*>[\s\S]*<img[^>]*>[\s\S]*图1：参考范围图[\s\S]*<li[^>]*>[\s\S]*公共空间锚点[\s\S]*<li[^>]*>[\s\S]*弹性预留控制/u,
  `expected injected image block to remain inside the first ordered list item through final rendering, got:\n${html}`,
);

console.log("qa-list-image-final-continuity-regression passed");
