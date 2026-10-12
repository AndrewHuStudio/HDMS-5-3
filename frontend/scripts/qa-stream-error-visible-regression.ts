import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { finalizeStreamingAssistantError } from "../features/qa/answer-replacement-state";


const failedAfterOverview = finalizeStreamingAssistantError({
  message: {
    id: "assistant-1",
    role: "assistant",
    content: "## 检索综述\n\n已找到相关资料。",
    createdAt: "00:27",
    isStreaming: true,
    renderState: "answering",
    sources: [],
  },
  detail: "模型未返回有效答案，请稍后重试。",
  precedingQuestion: "高密度城市如何定义？",
});

assert.match(failedAfterOverview.content, /检索综述/, "expected retrieval context to remain visible");
assert.match(failedAfterOverview.content, /模型未返回有效答案/, "expected the failure to be explicit");
assert.equal(failedAfterOverview.isStreaming, false);
assert.equal(failedAfterOverview.renderState, "error");

const failedBeforeContent = finalizeStreamingAssistantError({
  message: {
    id: "assistant-2",
    role: "assistant",
    content: "",
    createdAt: "00:28",
    isStreaming: true,
    renderState: "understanding",
  },
  detail: "服务暂不可用",
});
assert.equal(failedBeforeContent.content, "请求失败：服务暂不可用");

const qaViewSource = fs.readFileSync(path.resolve("features/qa/qa-view.tsx"), "utf8");
const visibleErrorFinalizers = qaViewSource.match(/finalizeStreamingAssistantError\(\{/g) || [];
assert.equal(
  visibleErrorFinalizers.length,
  2,
  "expected server error events and transport exceptions to share the visible error finalizer",
);

console.log("qa-stream-error-visible-regression passed");
