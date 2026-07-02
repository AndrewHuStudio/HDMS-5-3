import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QAMarkdownRenderer } from "../components/qa-new/qa-markdown-renderer";
import { buildAnswerCitationAnchorComponent } from "../features/qa/citation-engine/react/create-answer-citation-anchor";
import { processAnswerCitations } from "../features/qa/citation-engine/core/process-answer-citations";
import type { SourceInfo } from "../features/qa/types";

const sources: SourceInfo[] = [
  {
    type: "vector",
    source: "vector",
    citation_label: "1-3",
    name: "地下二、三层控制要求",
    chunk_id: "chunk-1",
  },
];

const anchorComponent = buildAnswerCitationAnchorComponent({
  sources,
  labelIndexMap: new Map([["1-3", 0]]),
  messageId: "assistant:qa:1",
  activeInstanceId: null,
  onCitationHover: () => {},
  onCitationSelect: () => {},
});

const html = renderToStaticMarkup(
  <QAMarkdownRenderer
    markdown={processAnswerCitations({
      text: "- 侧重商业与交通接驳功能，预留人行连接节点与服务设施空间 [1-3]。",
      sources,
    })}
    componentOverrides={{ a: anchorComponent }}
  />,
);

assert.match(html, />1-3<\/a>/u, "expected citation pill label to render");
assert.doesNotMatch(html, /\[<a /u, "expected leading bracket to be stripped around citation pill");
assert.doesNotMatch(html, /<\/a>\]/u, "expected trailing bracket to be stripped around citation pill");

console.log("qa-citation-pill-bracket-strip-regression passed");
