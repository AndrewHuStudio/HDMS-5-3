import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QACitationSourcePanel } from "../components/qa-new/qa-citation-source-panel";
import type { SourceInfo } from "../features/qa/types";

const sources: SourceInfo[] = [
  {
    type: "vector",
    source: "vector",
    citation_label: "1-4",
    name: "空间控制图",
    chunk_id: "chunk-1",
  },
];

const html = renderToStaticMarkup(
  <QACitationSourcePanel
    sources={sources}
    messageId="msg-qa"
    query="测试问题"
    layout="inline"
  />,
);

assert.match(html, /source-msg-qa-1-4/u, "expected source card to render a message-scoped citation target id");
assert.doesNotMatch(
  html,
  /ring-2 ring-sky-200\/80/u,
  "expected citation jumps to avoid a persistent selected-card ring style in static markup",
);

console.log("qa-citation-source-selection-regression passed");
