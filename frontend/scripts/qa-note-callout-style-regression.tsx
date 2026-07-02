import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QAMarkdownRenderer } from "../components/qa-new/qa-markdown-renderer";

const markdown = `注：所有管控要求均以《深圳市建筑科学研究院 与 深圳市设计促进中心 联合签署图纸》为准。`;

const html = renderToStaticMarkup(
  <QAMarkdownRenderer markdown={markdown} />,
);

assert.match(html, /qa-table-note/u, "expected note callout to render with the dedicated note-callout class");
assert.match(html, /备注说明/u, "expected note paragraph to render the unified blue callout label");
assert.match(html, /from-sky-50/u, "expected note paragraph to use the blue callout visual style");
assert.doesNotMatch(html, /amber/u, "expected legacy amber note styling to be removed");
assert.doesNotMatch(
  html,
  /<div class="qa-table-note[\s\S]*?<span class="block">/u,
  "expected note callout body to avoid an extra nested block wrapper inside the outer note container",
);
assert.match(
  html,
  /<div class="qa-table-note[\s\S]*?<div class="qa-table-note__body">/u,
  "expected note callout body to render via a dedicated body container",
);

console.log("qa-note-callout-style-regression passed");
