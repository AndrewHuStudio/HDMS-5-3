import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const input = `## 二、合规核查要点

- 核查维度说明
1. 空间分区合规性
    - 核查地下层（如和）是否严格划分停车区、设备区，避免功能混杂。
    - 检查地上层在0-8.4米高度内是否预留公共空间（如步行区）。

2. 高度与尺度匹配
    - 验证建筑高度是否不超过8.4米限值，并确保剖面中的垂直比例一致。
    - 通过组合图核验各层空间叠加是否冲突（如地下管道与地上绿化）。`;

const markdown = buildAnswerMarkdown({
  content: input,
  sources: [],
  isStreaming: false,
  renderPhase: "final",
});

assert(
  /- 核查维度说明/.test(markdown),
  `expected lead-in bullet to remain a bullet, got:\n${markdown}`,
);

assert(
  /\n1\. 空间分区合规性/.test(markdown) &&
    /\n2\. 高度与尺度匹配/.test(markdown),
  `expected ordered parent items to remain ordered, got:\n${markdown}`,
);

assert(
  /^\s{4}- 核查地下层/m.test(markdown) &&
    /^\s{4}- 检查地上层/m.test(markdown) &&
    /^\s{4}- 验证建筑高度/m.test(markdown) &&
    /^\s{4}- 通过组合图核验/m.test(markdown),
  `expected child bullets to stay nested under ordered parents, got:\n${markdown}`,
);

assert(
  !/\n- 空间分区合规性/.test(markdown) &&
    !/\n- 高度与尺度匹配/.test(markdown),
  `expected ordered parents not to be downgraded to bullets, got:\n${markdown}`,
);

console.log("qa-mixed-list-preservation-regression passed");
