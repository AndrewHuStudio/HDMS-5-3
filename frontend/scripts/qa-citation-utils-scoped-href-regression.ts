import assert from "node:assert/strict";
import { parseCitationLabelFromHref } from "../features/qa/citation-engine/core/citation-utils";

assert.equal(
  parseCitationLabelFromHref("#source-1-3"),
  "1-3",
  "expected plain href parsing to remain stable",
);

assert.equal(
  parseCitationLabelFromHref("#source-msg-1-1-3"),
  "1-3",
  "expected message-scoped href parsing to resolve final citation label",
);

console.log("qa-citation-utils-scoped-href-regression passed");
