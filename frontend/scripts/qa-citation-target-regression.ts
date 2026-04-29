import assert from "node:assert/strict";
import {
  buildCitationTargetHref,
  buildCitationTargetId,
} from "../features/qa/citation-engine";

const messageId = "assistant-qa-1";
const label = "1-3";
const docLabel = "1";

const exactId = buildCitationTargetId(label, messageId);
const exactHref = buildCitationTargetHref(label, messageId);

assert.equal(
  exactHref,
  `#${exactId}`,
  `expected citation href to point to exact source card id, got href=${exactHref}, id=${exactId}`,
);

const docLevelId = buildCitationTargetId(docLabel, messageId);
assert.equal(
  docLevelId,
  "source-assistant-qa-1-1",
  `expected doc-level fallback target to remain stable, got ${docLevelId}`,
);

assert.equal(
  buildCitationTargetHref(label),
  "#source-1-3",
  "expected non-message-scoped href to keep legacy fallback format",
);

console.log("qa-citation-target-regression passed");
