import {
  resolveAssistantAnswerMarkdown,
} from "../features/qa/render/resolve-answer-markdown";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const visibleBeforeDone = `1. 首层界面连续。
2. 二层连桥衔接。

![控制图](/api/rag/documents/demo/image?ref=bridge.png)

FIGCAPTION 图1：连桥控制图`;

const rebuiltAfterDone = `- 首层界面连续。
- 二层连桥衔接。`;

const resolvedDoneMarkdown = resolveAssistantAnswerMarkdown({
  content: rebuiltAfterDone,
  stableMarkdown: visibleBeforeDone,
  sources: [],
  isStreaming: false,
  renderPhase: "final",
});

assert(
  resolvedDoneMarkdown === visibleBeforeDone,
  `expected done phase to reuse cached stable markdown instead of rebuilding.\n--- expected ---\n${visibleBeforeDone}\n--- actual ---\n${resolvedDoneMarkdown}`,
);

const resolvedWithoutCache = resolveAssistantAnswerMarkdown({
  content: rebuiltAfterDone,
  sources: [],
  isStreaming: false,
  renderPhase: "final",
});

assert(
  resolvedWithoutCache === rebuiltAfterDone,
  `expected final phase without cache to use rebuilt content.\n--- expected ---\n${rebuiltAfterDone}\n--- actual ---\n${resolvedWithoutCache}`,
);

console.log("qa-done-uses-stable-markdown-regression passed");
