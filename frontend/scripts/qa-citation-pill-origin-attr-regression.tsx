import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CitationPill } from "../features/qa/citation-engine/react/citation-pill";

const html = renderToStaticMarkup(
  <CitationPill
    label="1-4"
    messageId="assistant:qa:1"
    activeInstanceId={null}
    onHover={() => {}}
    onSelect={() => {}}
  />,
);

assert.match(html, /data-citation-label="1-4"/u, "expected citation pill anchor to expose its citation label for stable event delegation");
assert.match(html, /data-citation-origin-id="citation-origin-assistant-qa-1-1-4-/u, "expected citation pill anchor to expose its origin id for jump-back handling");

console.log("qa-citation-pill-origin-attr-regression passed");
