import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";
import { QAMarkdownRenderer } from "../components/qa-new/qa-markdown-renderer";
import { buildAnswerCitationAnchorComponent } from "../features/qa/citation-engine/react/create-answer-citation-anchor";
import { buildCitationLabelIndexMap } from "../features/qa/citation-engine/core/citation-utils";
import type { SourceInfo } from "../features/qa/types";

const sources: SourceInfo[] = [
  {
    type: "vector",
    source: "vector",
    citation_label: "1-4",
    name: "空间控制图",
  },
  {
    type: "vector",
    source: "vector",
    citation_label: "1-5",
    name: "场所剖示图",
  },
];

const content = `## 详细解析

一、核心管控机制

1. 分层立体化控制 采用垂直分区模式明确各层功能定位（见图表）： | 空间层级 | 管控重点 | 对应图纸 |
| --- | --- | --- |
| 地下下一二层 | 设备用房/停车空间布局 | 图号05 |
| 地面下一层 | 商业衔接交通枢纽 | 图号04 |

1. 场所空间定制化
- 通过场所剖示图[1-5]解析公共空间的人流动线与生态节点
- 结合剖面设计控制视线通廊与绿色渗透（如空中连廊体系）[1-4]`;

const markdown = buildAnswerMarkdown({
  content,
  sources,
  isStreaming: false,
  renderPhase: "final",
});

const html = renderToStaticMarkup(
  <QAMarkdownRenderer
    markdown={markdown}
    componentOverrides={{
      a: buildAnswerCitationAnchorComponent({
        sources,
        labelIndexMap: buildCitationLabelIndexMap(sources),
        messageId: "msg-qa",
        activeInstanceId: null,
        onCitationHover: () => {},
        onCitationSelect: () => {},
      }),
    }}
  />,
);

assert.match(html, /<table[^>]*>/u, `expected table to render in numbered answer block\n--- markdown ---\n${markdown}\n--- html ---\n${html}`);
assert.match(markdown, /2\. 场所空间定制化/u, "expected second numbered item to stay sequential after table block");
assert.doesNotMatch(markdown, /## 一、核心管控机制/u, "expected section lead-in not to be promoted into an H2 heading");
assert.match(html, /href="#source-msg-qa-1-5"/u, "expected citation pill href to remain message-scoped and clickable");
assert.match(html, /href="#source-msg-qa-1-4"/u, "expected trailing citation pill href to remain message-scoped and clickable");

console.log("qa-list-table-citation-continuity-regression passed");
