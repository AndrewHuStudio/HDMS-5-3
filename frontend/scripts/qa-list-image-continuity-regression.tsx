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
    citation_label: "1-3",
    name: "深圳湾科技生态园空间控制图",
    image_url: "/api/rag/documents/demo/image?ref=grid.png",
    image_name: "参考配图",
    image_figures: ["图2"],
    image_captions: ["参考配图"],
  },
];

const content = `## 三、弹性控制机制

1. 动态单元划分 通过模拟化网格（见图2）将地块划分为2000㎡标准单元，允许功能置换但需满足：[1-3]

- 单元内主导功能面积占比≥60%
- 相邻单元兼容性指数≥0.7

1. 强度梯度调节 容积率按离地铁站点距离分级控制：

- 核心区
- 次级区`;

const markdown = buildAnswerMarkdown({
  content,
  sources,
  isStreaming: false,
  renderPhase: "final",
});

const html = renderToStaticMarkup(<QAMarkdownRenderer markdown={markdown} />);
const compact = html.replace(/\s+/g, " ");

assert.match(markdown, /FIGCAPTION\s+图1/u, "expected figure caption to be injected into markdown");
assert.match(markdown, /2\. 强度梯度调节/u, "expected second ordered item to stay sequential in markdown");
assert.doesNotMatch(markdown, /^### 1\./mu, "expected first ordered item not to be promoted into a heading");
assert.match(compact, /<ol[^>]*>\s*<li[^>]*>[\s\S]*图1：参考配图[\s\S]*<li[^>]*>\s*<p[^>]*>强度梯度调节/u, "expected injected image block to remain inside a single ordered list");

const orderedListCount = (html.match(/<ol(?:\s|>)/g) || []).length;
assert.equal(orderedListCount, 1, `expected one ordered list after image injection, got ${orderedListCount}\n${html}`);

console.log("qa-list-image-continuity-regression passed");
