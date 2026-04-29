import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QAMarkdownRenderer } from "../components/qa-new/qa-markdown-renderer";

const markdown = `## 详细解析

这是一个**重点结论**，并且包含 \`控制指标\` 这样的行内代码。

> 提示：地下空间需要结合交通组织综合判断。

1. 空间结构

    - 地上一层与下沉广场衔接
    - 地下空间承担配套交通

| 维度 | 内容 |
| --- | --- |
| 功能组合 | 研发与公共服务复合 |

![参考图](/api/rag/documents/demo/image?ref=a.png)

FIGCAPTION 图1：参考配图

\`\`\`text
控制高度：24m
退界距离：6m
\`\`\``;

const html = renderToStaticMarkup(
  <QAMarkdownRenderer markdown={markdown} />,
);

assert.match(html, /<h2[^>]*>详细解析<\/h2>/u, "expected h2 heading to remain rendered");
assert.match(html, /class="[^"]*qa-heading-1[^"]*"/u, "expected heading style hook to remain present");
assert.match(html, /<ol[^>]*>/u, "expected ordered list to remain rendered");
assert.match(html, /<ul[^>]*>/u, "expected nested bullet list to remain rendered");
assert.match(html, /<table[^>]*>/u, "expected table to remain rendered");
assert.match(html, /<img[^>]*>/u, "expected image to remain rendered");
assert.match(html, /图1：参考配图/u, "expected figure caption text to remain rendered");
assert.match(html, /class="[^"]*qa-paragraph[^"]*"/u, "expected paragraph style hook to remain present");
assert.match(html, /class="[^"]*qa-strong[^"]*"/u, "expected strong emphasis style hook to remain present");
assert.match(html, /class="[^"]*qa-inline-code[^"]*"/u, "expected inline code style hook to remain present");
assert.match(html, /class="[^"]*qa-callout[^"]*"/u, "expected blockquote style hook to remain present");
assert.match(html, /class="[^"]*qa-list[^"]*qa-list--ordered[^"]*"/u, "expected ordered list style hook to remain present");
assert.match(html, /class="[^"]*qa-list[^"]*qa-list--unordered[^"]*"/u, "expected unordered list style hook to remain present");
assert.match(html, /class="[^"]*qa-list-item[^"]*"/u, "expected list item style hook to remain present");
assert.match(html, /class="[^"]*qa-table-wrap[^"]*"/u, "expected table wrapper style hook to remain present");
assert.match(html, /class="[^"]*qa-data-table[^"]*"/u, "expected table style hook to remain present");
assert.match(html, /class="[^"]*qa-table-head[^"]*"/u, "expected table head style hook to remain present");
assert.match(html, /class="[^"]*qa-table-cell[^"]*"/u, "expected table cell style hook to remain present");
assert.match(html, /class="[^"]*qa-figure-image[^"]*"/u, "expected image style hook to remain present");
assert.match(html, /class="[^"]*qa-figure-caption[^"]*"/u, "expected figure caption style hook to remain present");
assert.match(html, /class="[^"]*qa-pre-block[^"]*"/u, "expected pre block style hook to remain present");
assert.match(html, /class="[^"]*qa-code-block[^"]*"/u, "expected code block style hook to remain present");

console.log("qa-render-style-regression passed");
