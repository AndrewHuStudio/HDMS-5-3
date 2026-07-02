import assert from "node:assert/strict";
import {
  advancePendingCitationSelection,
  createPendingCitationSelection,
} from "../features/qa/citation-engine/core";

const initialSelection = createPendingCitationSelection({
  label: "2-2",
  originId: "citation-origin-assistant-qa-1-2-2",
});

assert.deepEqual(
  initialSelection,
  {
    label: "2-2",
    originId: "citation-origin-assistant-qa-1-2-2",
    attempts: 0,
  },
  "expected queued citation jump to preserve label/origin and start with zero retries",
);

const queuedWhileTargetsHidden = advancePendingCitationSelection({
  pendingSelection: initialSelection,
  found: false,
  sourceTargetsEnabled: false,
  maxAttempts: 6,
});

assert.deepEqual(
  queuedWhileTargetsHidden,
  initialSelection,
  "expected citation click during streaming to stay queued until source targets are mounted",
);

const retriedAfterTargetsMount = advancePendingCitationSelection({
  pendingSelection: initialSelection,
  found: false,
  sourceTargetsEnabled: true,
  maxAttempts: 6,
});

assert.deepEqual(
  retriedAfterTargetsMount,
  {
    label: "2-2",
    originId: "citation-origin-assistant-qa-1-2-2",
    attempts: 1,
  },
  "expected queued citation jump to keep retrying once source targets become available",
);

const clearedWhenResolved = advancePendingCitationSelection({
  pendingSelection: {
    ...initialSelection,
    attempts: 1,
  },
  found: true,
  sourceTargetsEnabled: true,
  maxAttempts: 6,
});

assert.equal(
  clearedWhenResolved,
  null,
  "expected queued citation jump to clear once a later retry resolves the target",
);

const clearedAtRetryBudget = advancePendingCitationSelection({
  pendingSelection: {
    ...initialSelection,
    attempts: 5,
  },
  found: false,
  sourceTargetsEnabled: true,
  maxAttempts: 6,
});

assert.equal(
  clearedAtRetryBudget,
  null,
  "expected queued citation jump to stop retrying after the configured retry budget",
);

console.log("qa-citation-streaming-pending-jump-regression passed");
