import { PHASE_MATRIX } from "../lib/normalize-rules/phase-matrix";
import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// block-parser must run in ALL phases to guarantee streaming === final
const blockParserPhases = PHASE_MATRIX["block-parser"];
assert(blockParserPhases, "expected block-parser phase configuration to exist");
assert(
  blockParserPhases.has("streaming") && blockParserPhases.has("final"),
  "expected block-parser to run in both streaming and final phases",
);

// Core invariant: same content + same sources → streaming output === final output
const input = `一、概述

| 指标 | 数值 |
| --- | --- |
| 容积率 | 3.5 |

二、详细分析
- 建筑高度不超过100m`;

const streaming = buildAnswerMarkdown({ content: input, sources: [], isStreaming: true, renderPhase: "streaming" });
const final_ = buildAnswerMarkdown({ content: input, sources: [], isStreaming: false, renderPhase: "final" });
assert(
  streaming === final_,
  `expected streaming === final for identical content.\n--- streaming ---\n${streaming}\n--- final ---\n${final_}`,
);

console.log("qa-streaming-normalization-regression passed");
