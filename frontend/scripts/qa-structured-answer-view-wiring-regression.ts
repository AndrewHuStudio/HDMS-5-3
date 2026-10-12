import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";


const source = readFileSync(resolve("features/qa/qa-view.tsx"), "utf8");

assert(source.includes("onAnswerDocument:"), "QA view must consume the structured answer event");
assert(
  source.includes("composeAnswerDocumentMarkdown"),
  "QA view must compile the validated document instead of injecting images heuristically",
);

console.log("qa-structured-answer-view-wiring-regression passed");
