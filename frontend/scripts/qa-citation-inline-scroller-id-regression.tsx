import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QACitationSourcePanel } from "../components/qa-new/qa-citation-source-panel";
import type { SourceInfo } from "../features/qa/types";

const sources: SourceInfo[] = [
  {
    type: "vector",
    source: "vector",
    citation_label: "1-1",
    name: "DU01-01、DU01-02、DU01-03地块开发建设实施手册.pdf",
    chunk_id: "chunk-1-1",
  },
];

const html = renderToStaticMarkup(
  <QACitationSourcePanel
    sources={sources}
    messageId="assistant:qa:1"
    query="测试问题"
    activeCitationLabel="1-1"
    layout="inline"
  />,
);

assert.match(
  html,
  /citation-source-list-assistant-qa-1/u,
  "expected embedded inline source panel to render a message-scoped source container id for pending citation jumps",
);

assert.match(
  html,
  /data-citation-target-label="1-1"/u,
  "expected embedded inline source panel to mount matching source target cards",
);

console.log("qa-citation-inline-scroller-id-regression passed");
