import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

import { buildAssistantRenderModel } from "../features/qa/render/assistant-render-state-machine";


const waiting = buildAssistantRenderModel({
  state: "retrieving",
  isStreaming: true,
  hasAnswer: false,
  hasRetrievalStats: true,
});
assert.equal(waiting.showLoadingIndicator, true, "expected a visible loading state before answer text arrives");

const answering = buildAssistantRenderModel({
  state: "answering",
  isStreaming: true,
  hasAnswer: true,
  hasRetrievalStats: true,
});
assert.equal(answering.showLoadingIndicator, false, "expected loading state to stop after answer text arrives");

const source = fs.readFileSync(
  path.resolve("components/qa-new/qa-assistant-content.tsx"),
  "utf8",
);
assert.match(source, /role="status"/, "expected the loading indicator to expose status semantics");
assert.match(source, /aria-live="polite"/, "expected non-interrupting status announcements");
assert.match(source, /statusMessage/, "expected the loading indicator to show the current backend status");
assert.match(source, /qa-inline-dot--1/, "expected the existing reduced-motion-aware dot animation");

console.log("qa-loading-indicator-regression passed");
