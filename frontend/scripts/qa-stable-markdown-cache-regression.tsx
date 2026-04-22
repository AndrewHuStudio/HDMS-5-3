import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const content = `二、生态与技术协同机制

| 控制目标 | 实现手段 | 图纸依据 |
| --- | --- | --- |
| 垂直绿化 | 剖面（图06）标注绿植符号（▲）于建筑侧墙，覆盖率通过网格密度计算 | 场所剖示图 |

三、合规核查与优化建议1.设计合规性重点
- 新建方案需对齐空间控制图的层高划分。`;

const stableMarkdown = buildAnswerMarkdown({
  content,
  sources: [],
  isStreaming: true,
  renderPhase: "finalizing",
  finalizedByServer: true,
});

const rebuiltAfterDone = buildAnswerMarkdown({
  content,
  sources: [],
  isStreaming: false,
  renderPhase: "final",
  finalizedByServer: true,
});

assert(
  stableMarkdown === rebuiltAfterDone,
  `expected final build to reuse stable finalizing result.\n--- stable ---\n${stableMarkdown}\n--- rebuilt ---\n${rebuiltAfterDone}`,
);

console.log("qa-stable-markdown-cache-regression passed");
