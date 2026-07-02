import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";
import { QAMarkdownRenderer } from "../components/qa-new/qa-markdown-renderer";

const scenarios = [
  {
    name: "ordered-list compressed table with trailing source note",
    content: `2. 地下空间 | 层级 | 功能定位 | 管控要点 | 图号 | | --- | --- | --- | --- | | 地下一层 | 商业/交通接驳 | 人车分流通道宽度 ≥8m | 04 | | 地下二、三层 | 停车场/设备用房 | 货运通道净高 ≥4.5m | 05 | 数据来源：[1-3][1-4]`,
    header: /\| 层级 \| 功能定位 \| 管控要点 \| 图号 \|/u,
    body: /\| 地下一层 \| 商业\/交通接驳 \| 人车分流通道宽度 ≥8m \| 04 \|/u,
    trailingNote: /数据来源[:：]/u,
  },
  {
    name: "fullwidth-pipe compressed table with table note",
    content: `3. 生态技术指标 ｜ 指标 ｜ 要求 ｜ 对应图示 ｜ ｜ --- ｜ --- ｜ --- ｜ ｜ 立体绿化率 ｜ ≥30% ｜ 图01 ｜ ｜ 地面透水铺装率 ｜ ≥60% ｜ 图02 ｜ ｜ 注：以上指标需结合方案深化复核`,
    header: /\| 指标 \| 要求 \| 对应图示 \|/u,
    body: /\| 地面透水铺装率 \| ≥60% \|.*图02.*\|/u,
    trailingNote: /注[:：]\s*以上指标需结合方案深化复核/u,
  },
];

for (const scenario of scenarios) {
  const markdown = buildAnswerMarkdown({
    content: scenario.content,
    sources: [],
    isStreaming: false,
    renderPhase: "final",
  });

  const html = renderToStaticMarkup(
    <QAMarkdownRenderer markdown={markdown} />,
  );

  assert.match(markdown, scenario.header, `${scenario.name}: expected normalized markdown to contain a standalone table header`);
  assert.match(markdown, scenario.body, `${scenario.name}: expected normalized markdown to contain the restored table row`);
  assert.match(html, /<table[^>]*>/u, `${scenario.name}: expected compressed table to render as a real table`);
  assert.doesNotMatch(html, /<p[^>]*>[^<]*(?:层级|指标)\s*\|/u, `${scenario.name}: expected compressed table content not to remain trapped in a paragraph`);
  assert.match(markdown, scenario.trailingNote, `${scenario.name}: expected trailing source/note text to survive normalization outside the table rows`);
}

console.log("qa-compressed-table-regression passed");
