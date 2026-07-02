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
];

const content = `## 三、规划实施特点

1. **立体分层开发** 通过（图1）可见多功能空间（商业/交通/设备）的垂直叠合，实现土地集约利用。[1-4]

1. **公共空间锚点** 场所剖示图显示下沉广场、中庭等节点作为活力核心，引导人流聚集。`;

const markdown = buildAnswerMarkdown({
  content,
  sources,
  isStreaming: false,
  renderPhase: "final",
});

const html = renderToStaticMarkup(<QAMarkdownRenderer markdown={markdown} />);
const compact = html.replace(/\s+/g, " ");
const imageClassMatch = html.match(/<img[^>]*class="([^"]*qa-figure-image[^"]*qa-figure-image--list-nested[^"]*)"[^>]*>/u);
const captionClassMatch = html.match(/<p[^>]*class="([^"]*qa-figure-caption[^"]*qa-figure-caption--list-nested[^"]*)"[^>]*>/u);

assert.match(
  html,
  /class="[^"]*qa-figure-image[^"]*qa-figure-image--list-nested[^"]*"/u,
  `expected list-nested image to expose the dedicated style hook, got:\n${html}`,
);

assert.ok(
  imageClassMatch,
  `expected nested image class string to be capturable, got:\n${html}`,
);

assert.doesNotMatch(
  imageClassMatch[1],
  /border-sky|from-sky|to-sky|via-sky|text-sky|rgba\(14,165,233/u,
  `expected list-nested image card to avoid blue-emphasis utility classes, got:\n${imageClassMatch[1]}`,
);

assert.match(
  html,
  /class="[^"]*qa-figure-caption[^"]*qa-figure-caption--list-nested[^"]*"/u,
  `expected list-nested figure caption to expose the dedicated style hook, got:\n${html}`,
);

assert.ok(
  captionClassMatch,
  `expected nested caption class string to be capturable, got:\n${html}`,
);

assert.doesNotMatch(
  captionClassMatch[1],
  /border-sky|from-sky|to-sky|via-sky|text-sky|rgba\(14,165,233/u,
  `expected list-nested figure caption to avoid blue-emphasis utility classes, got:\n${captionClassMatch[1]}`,
);

assert.match(
  compact,
  /<li[^>]*>[\s\S]*qa-figure-image--list-nested[\s\S]*qa-figure-caption--list-nested[\s\S]*<li[^>]*>/u,
  `expected nested image and caption to stay grouped inside the ordered list item, got:\n${html}`,
);

console.log("qa-list-image-card-style-regression passed");
