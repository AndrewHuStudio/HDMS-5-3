import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";


const activeFiles = [
  "features/qa/qa-view.tsx",
  "features/qa/render/answer-markdown-pipeline.ts",
  "lib/sse-client.ts",
];

for (const path of activeFiles) {
  const source = readFileSync(resolve(path), "utf8");
  assert(!source.includes("injectAnswerImages"), `${path} must not call legacy image injection`);
  assert(!source.includes("structuredImageMarker"), `${path} must not score legacy IMG anchors`);
  assert(!source.includes("[[IMG:"), `${path} must not contain the legacy anchor protocol`);
}

console.log("qa-no-legacy-image-anchor-regression passed");
