import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";
import { QAMarkdownRenderer } from "../components/qa-new/qa-markdown-renderer";

const content = `1. 分层立体化控制 采用垂直分区模式明确各层功能定位（见图表）： | 空间层级 | 管控重点 | 对应图纸 |
| --- | --- | --- |
| 地下下一二层 | 设备用房/停车空间布局 | 图号05 |
| 地面下一层 | 商业衔接交通枢纽 | 图号04 |`;

const markdown = buildAnswerMarkdown({
  content,
  sources: [],
  isStreaming: false,
  renderPhase: "final",
});

const html = renderToStaticMarkup(
  <QAMarkdownRenderer markdown={markdown} />,
);

assert.match(markdown, /\n\| 空间层级 \| 管控重点 \| 对应图纸 \|/u, "expected inline table header to be split onto its own line");
assert.match(html, /<table[^>]*>/u, "expected inline table boundary case to render as a real table");
assert.doesNotMatch(html, /<p[^>]*>[^<]*\|\s*空间层级/u, "expected table header not to remain trapped in paragraph text");

console.log("qa-inline-table-boundary-regression passed");
