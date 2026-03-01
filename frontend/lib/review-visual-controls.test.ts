import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReviewToolId } from "./review-visual-controls";

test("normalizeReviewToolId maps checklist alias to tool id", () => {
  assert.equal(normalizeReviewToolId("sight-corridor"), "view-corridor-check");
});

test("normalizeReviewToolId keeps valid review tool ids", () => {
  assert.equal(normalizeReviewToolId("setback-rate-check"), "setback-rate-check");
});

test("normalizeReviewToolId returns null for unknown ids", () => {
  assert.equal(normalizeReviewToolId("qa-assistant"), null);
});
