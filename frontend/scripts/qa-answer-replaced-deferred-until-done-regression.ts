function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

import {
  finalizeStreamingAssistantMessage,
  stageServerAnswerReplacement,
} from "../features/qa/answer-replacement-state";

const streaming = {
  id: "assistant-1",
  role: "assistant" as const,
  content: "原始流式正文",
  createdAt: "10:00",
  renderState: "answering" as const,
  isStreaming: true,
};

const afterReplacement = stageServerAnswerReplacement({
  message: streaming,
  fullAnswer: "1. 最终增强正文\n2. 第二点",
  replacedSources: [{ type: "vector", name: "示例.pdf", source: "示例.pdf", citation_label: "1-1" }],
  accepted: true,
});

assert(afterReplacement.content === "原始流式正文", "expected streaming content to remain visible before done");
assert(afterReplacement.pendingFinalContent === "1. 最终增强正文\n2. 第二点", "expected final replacement to be deferred");
assert(afterReplacement.isStreaming === true, "expected streaming to continue before done");
assert(afterReplacement.renderState === "answering", "expected answer_replaced not to force finalizing render state");

const afterDone = finalizeStreamingAssistantMessage({
  message: afterReplacement,
});

assert(afterDone.content === "1. 最终增强正文\n2. 第二点", "expected deferred final content to take over on done");
assert(afterDone.pendingFinalContent === undefined, "expected pending final content to be cleared on done");
assert(afterDone.isStreaming === false, "expected streaming to stop on done");
assert(afterDone.renderState === "done", "expected done event to finalize render state");
assert(
  afterDone.stableMarkdown === "1. 最终增强正文\n2. 第二点",
  `expected final visible markdown to be rebuilt from deferred final content on done.\n--- actual ---\n${afterDone.stableMarkdown}`,
);
assert(afterDone.sources?.length === 1, "expected deferred final sources to be applied on done");

console.log("qa-answer-replaced-deferred-until-done-regression passed");

export {};
