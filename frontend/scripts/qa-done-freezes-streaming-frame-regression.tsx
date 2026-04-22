import { captureVisibleAnswerMarkdown, resolveAssistantAnswerMarkdown } from "../features/qa/render/resolve-answer-markdown";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const streamingContent = `一、建议措施
1. 优化首层界面
2. 补充风雨连廊
3. 完善地下接驳`;

const stableMarkdown = captureVisibleAnswerMarkdown({
  content: streamingContent,
  sources: [],
  isStreaming: true,
  renderState: "answering",
});

const doneMarkdown = resolveAssistantAnswerMarkdown({
  content: streamingContent,
  stableMarkdown,
  sources: [],
  isStreaming: false,
  renderPhase: "final",
});

assert(
  doneMarkdown === stableMarkdown,
  `expected done phase to freeze the last visible streaming markdown.\n--- stable ---\n${stableMarkdown}\n--- done ---\n${doneMarkdown}`,
);

console.log("qa-done-freezes-streaming-frame-regression passed");
