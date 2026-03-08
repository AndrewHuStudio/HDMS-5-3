import assert from "node:assert/strict";
import { runNormalizationPipeline } from "../lib/normalize-rules/index";

const input = `1. 竖向分层 丨 空间层级 丨 开发深度 丨 主导功能 丨 建设强度要求
丨 --- 丨 --- 丨 --- 丨 --- 丨 --- 丨
丨 地上 丨 +0m以上 丨 商业办公、公共服务 丨 容积率≥3.8 丨
丨 地面 丨 ±0m层 丨 交通枢纽、公共活动 丨 步行可达性100%覆盖 丨`;

const output = runNormalizationPipeline(input, { phase: "final" });

assert.match(output, /^\|\s*1\.\s*竖向分层\s*\|/m, "Header row should be normalized into a GFM table");
assert.match(output, /^\|\s*---\s*\|/m, "Separator row should exist after normalization");
assert.match(output, /^\|\s*地上\s*\|/m, "Body rows should be preserved as table rows");

console.log("qa table pipe-variant regression checks passed");