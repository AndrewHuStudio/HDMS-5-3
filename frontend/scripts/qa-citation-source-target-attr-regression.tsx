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
    messageId="assistant:qa:1"
    query="测试问题"
    activeCitationLabel="1-4"
    layout="inline"
  />,
);

assert.match(html, /data-citation-target-label="1-4"/u, "expected source card to expose a label-based fallback target attribute");
assert.match(html, /data-citation-target-message="assistant-qa-1"/u, "expected source card fallback target to remain message-scoped");

console.log("qa-citation-source-target-attr-regression passed");
