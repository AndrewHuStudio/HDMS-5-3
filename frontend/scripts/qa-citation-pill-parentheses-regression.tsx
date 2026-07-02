import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QAMarkdownRenderer } from "../components/qa-new/qa-markdown-renderer";
import { buildAnswerCitationAnchorComponent } from "../features/qa/citation-engine/react/create-answer-citation-anchor";
import { buildCitationLabelIndexMap } from "../features/qa/citation-engine/core/citation-utils";
import type { SourceInfo } from "../features/qa/types";

const sources: SourceInfo[] = [
  {
    type: "vector",
    source: "vector",
    citation_label: "1-3",
    name: "深圳湾科技生态园空间控制图",
  },
];

const componentOverrides = {
  a: buildAnswerCitationAnchorComponent({
    sources,
    labelIndexMap: buildCitationLabelIndexMap(sources),
    messageId: "msg-1",
    activeInstanceId: null,
    onCitationHover: () => {},
    onCitationSelect: () => {},
  }),
};

const html = renderToStaticMarkup(
  <QAMarkdownRenderer
    markdown={`说明文字（[1-3](#source-msg-1-1-3)）继续输出。`}
    componentOverrides={componentOverrides}
  />,
);

assert.doesNotMatch(html, /（\s*<span[^>]*>[\s\S]*1-3[\s\S]*<\/span>\s*）/u, "expected citation pill to render without wrapper parentheses");
assert.match(html, /<a[^>]*href="#source-msg-1-1-3"[^>]*>1-3<\/a>/u, "expected scoped citation href to remain rendered as a clickable pill");

console.log("qa-citation-pill-parentheses-regression passed");
