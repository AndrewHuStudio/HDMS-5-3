import assert from "node:assert/strict";
import { runNormalizationPipeline } from "../lib/normalize-rules";

const input = `1. 动态单元划分 通过模拟化网格（见图2）将地块划分为2000㎡标准单元，允许功能置换但需满足：[1-3]`;

const normalized = runNormalizationPipeline(input, {
  phase: "final",
});

assert.equal(
  normalized,
  input,
  `expected inline figure reference to remain on the same line.\n--- actual ---\n${normalized}`,
);

console.log("qa-inline-figure-ref-splitting-regression passed");
