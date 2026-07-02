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
    layout="sidebar"
  />,
);

assert.match(
  html,
  /citation-source-list-assistant-qa-1/u,
  "expected sidebar source panel to render a message-scoped scroll container id",
);

assert.match(
  html,
  /overflow-y-auto/u,
  "expected sidebar source panel to expose its own vertical scroll container",
);

console.log("qa-citation-sidebar-scroller-regression passed");
