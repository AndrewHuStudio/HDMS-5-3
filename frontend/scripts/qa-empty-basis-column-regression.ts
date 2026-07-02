import assert from "node:assert/strict";
import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";

const emptyBasisInput = `## 二、功能复合度强制指标

| 空间层级 | 主导功能 | 兼容功能 | 混合比例要求 | 依据 |
| --- | --- | --- | --- | --- |
| 地下1-2层 | 停车 | 商业/物流 | 按分区动态调整 |  |
| 地面层 | 商业服务 | 公共通道 | 绿化率≥25% |   |
| 研发楼层 | 办公 | 休闲交流 | 每层需设共享中庭 | `;

const emptyBasisOutput = buildAnswerMarkdown({
  content: emptyBasisInput,
  sources: [],
  isStreaming: false,
  renderPhase: "final",
});

assert.doesNotMatch(emptyBasisOutput, /\|\s*依据\s*\|/u, "expected empty 依据 column to be removed");
assert.doesNotMatch(emptyBasisOutput, /\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*\|/u, "expected 5-column separator to shrink after removing empty 依据 column");

const nonEmptyBasisInput = `| 指标 | 要求 | 依据 |
| --- | --- | --- |
| 绿地率 | ≥25% | 空间控制图编号01-06 |`;

const nonEmptyBasisOutput = buildAnswerMarkdown({
  content: nonEmptyBasisInput,
  sources: [],
  isStreaming: false,
  renderPhase: "final",
});

assert.match(nonEmptyBasisOutput, /\|\s*依据\s*\|/u, "expected populated 依据 column to remain");
assert.match(nonEmptyBasisOutput, /空间控制图编号01-06/u, "expected populated 依据 cell to remain");

console.log("qa-empty-basis-column-regression passed");
