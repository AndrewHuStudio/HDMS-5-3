import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const input = `![参考图](/api/rag/documents/demo/image?ref=a.png)

FIGCAPTION 图1：参考配图[1-1]

- 连廊系统：通过空中连廊连接建筑体块，提升步行通达性（见图号02的空间控制图）[1-3]。
1. 地下空间-地下一层：以商业配套与交通接驳功能为主（图号04）[1-4]。
- 地下二、三层：侧重停车设施与设备用房（图号05）。

二、核心规划特征

| 维度 | 管控要点 |
| --- | --- |
| 功能复合 | 商业、办公、公共空间在竖向分层混合布局，避免功能割裂（图2）。 |

![参考图](/api/rag/documents/demo/image?ref=b.png)

FIGCAPTION 图2：参考配图[1-3]

| 空间连续性 | 通过剖示图（图号06）验证各层空间流线是否连贯，确保人行动线无缝衔接。 |
| 开发强度 | 地下三层深度开发（-2至-3层）反映高强度土地利用导向。 |

三、合规核查与优化建议1.设计合规性重点
- 新建方案需对齐空间控制图的层高划分。`;

const finalizing = buildAnswerMarkdown({
  content: input,
  sources: [],
  isStreaming: true,
  renderPhase: "finalizing",
  finalizedByServer: true,
});

const final = buildAnswerMarkdown({
  content: input,
  sources: [],
  isStreaming: false,
  renderPhase: "final",
  finalizedByServer: true,
});

assert(
  finalizing === final,
  `expected finalizing/final markdown to stay identical after server finalization.\n--- finalizing ---\n${finalizing}\n--- final ---\n${final}`,
);

console.log("qa-phase-stability-regression passed");
