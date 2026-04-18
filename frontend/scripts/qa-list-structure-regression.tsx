import React from "react";
import ReactMarkdown from "react-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const input = `一、条文导引

1. 空间分层控制要求：
- 地上层（0-8.4米）需预留公共步行通道和绿化缓冲带。
- 地下层强调停车、仓储与服务设施的整合。

1. 生态兼容性规范：
- 场所剖示图体现生态廊道设计要求。

1. 功能布局导则：
- 各层空间组合图要求科技研发区与公共服务区相邻布局。`;

const markdown = buildAnswerMarkdown({
  content: input,
  sources: [],
  isStreaming: false,
  renderPhase: "final",
});

const html = renderToStaticMarkup(
  <ReactMarkdown>{markdown}</ReactMarkdown>,
);

const topLevelOlCount = (html.match(/<ol(?:\s|>)/g) || []).length;
const topLevelUlCount = (html.match(/<ul(?:\s|>)/g) || []).length;
const orderedItemCount = (html.match(/<li>\s*<p>(?:空间分层控制要求：|生态兼容性规范：|功能布局导则：)<\/p>/g) || []).length;
const compactHtml = html.replace(/\s+/g, " ");
const hasNestedOrderedListStructure =
  /<ol>\s*<li>\s*<p>空间分层控制要求：<\/p>\s*<ul>/.test(compactHtml) &&
  /<li>\s*<p>生态兼容性规范：<\/p>\s*<ul>/.test(compactHtml) &&
  /<li>\s*<p>功能布局导则：<\/p>\s*<ul>/.test(compactHtml);

assert(
  markdown.includes("1. 空间分层控制要求") &&
    markdown.includes("2. 生态兼容性规范") &&
    markdown.includes("3. 功能布局导则"),
  `expected normalized sequential numbering, got:\n${markdown}`,
);

assert(
  /^\s{4}- 地上层/m.test(markdown) &&
    /^\s{4}- 地下层/m.test(markdown) &&
    /^\s{4}- 场所剖示图/m.test(markdown) &&
    /^\s{4}- 各层空间组合图/m.test(markdown),
  `expected child bullets to use four-space nested indentation, got:\n${markdown}`,
);

assert(
  topLevelOlCount === 1,
  `expected one ordered list in rendered HTML, got ${topLevelOlCount}:\n${html}`,
);

assert(
  topLevelUlCount === 3,
  `expected one nested bullet list per ordered item, got ${topLevelUlCount}:\n${html}`,
);

assert(
  orderedItemCount === 3,
  `expected three ordered parent items, got ${orderedItemCount}:\n${html}`,
);

assert(
  hasNestedOrderedListStructure,
  `expected ordered items to wrap nested bullet lists, got:\n${html}`,
);

console.log("qa-list-structure-regression passed");
