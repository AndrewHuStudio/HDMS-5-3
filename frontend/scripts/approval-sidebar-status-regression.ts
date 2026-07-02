import assert from "node:assert/strict";
import {
  resolveReviewSidebarToolStatusMap,
  resolveReviewToolId,
} from "../lib/review-tool-links";

const toolStatusMap = {
  "height-check": "pass",
  "view-corridor-check": "fail",
  "fire-ladder-check": "pass",
  "sky-bridge-check": "fail",
} as const;

assert.equal(resolveReviewToolId("height-check"), "height-check");
assert.equal(resolveReviewToolId("sight-corridor"), "view-corridor-check");
assert.equal(resolveReviewToolId("fire-ladder"), "fire-ladder-check");
assert.equal(resolveReviewToolId("sky-bridge"), "sky-bridge-check");

assert.deepEqual(
  resolveReviewSidebarToolStatusMap("/reviews", { ...toolStatusMap }),
  toolStatusMap,
);
assert.deepEqual(
  resolveReviewSidebarToolStatusMap("/approvals", { ...toolStatusMap }),
  toolStatusMap,
);

console.log("approval-sidebar-status-regression passed");
