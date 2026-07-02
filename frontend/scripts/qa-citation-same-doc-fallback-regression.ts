import assert from "node:assert/strict";
import { jumpToCitationSource } from "../features/qa/citation-engine/core";

function createClassList() {
  const values = new Set<string>();
  return {
    add(name: string) {
      values.add(name);
    },
    remove(name: string) {
      values.delete(name);
    },
    has(name: string) {
      return values.has(name);
    },
  };
}

function createRect(top: number, height: number) {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 320,
    width: 320,
    height,
    x: 0,
    y: top,
    toJSON() {
      return {};
    },
  };
}

const selectorCalls: string[] = [];
let sourceScrollToTop: number | null = null;

const fallbackTarget = {
  id: "source-assistant-qa-1-2-1",
  dataset: {
    citationTargetLabel: "2-1",
  },
  offsetHeight: 52,
  classList: createClassList(),
  getBoundingClientRect: () => createRect(420, 52),
  getAttribute(name: string) {
    if (name === "data-citation-target-label") return "2-1";
    if (name === "data-citation-target-message") return "assistant-qa-1";
    return null;
  },
  scrollIntoView: () => {
    throw new Error("expected same-doc fallback to keep using source scroller");
  },
} as const;

const sourceScroller = {
  scrollTop: 80,
  clientHeight: 280,
  getBoundingClientRect: () => createRect(100, 280),
  scrollTo: ({ top }: { top: number }) => {
    sourceScrollToTop = top;
  },
} as const;

const result = jumpToCitationSource({
  label: "2-2",
  messageId: "assistant:qa:1",
  documentRef: {
    getElementById() {
      return null;
    },
    querySelector(selector: string) {
      selectorCalls.push(selector);
      if (selector === `[data-citation-target-label^="2-"][data-citation-target-message="assistant-qa-1"]`) {
        return fallbackTarget as unknown as Element;
      }
      return null;
    },
  },
  sourceScrollContainer: sourceScroller as unknown as HTMLElement,
  flashDurationMs: 0,
});

assert.equal(
  selectorCalls.includes(`[data-citation-target-label^="2-"][data-citation-target-message="assistant-qa-1"]`),
  true,
  "expected citation jump to look for another source chunk in the same document when the exact chunk label is missing",
);
assert.equal(result.found, true, "expected citation jump to fall back to another source card in the same document");
assert.equal(result.targetId, "source-assistant-qa-1-2-1", "expected citation jump to land on the available same-document source card");
assert.equal(result.usedDocLevelFallback, true, "expected same-document chunk resolution to be reported as a doc-level fallback");
assert.equal(result.resolvedLabel, "2-1", "expected citation jump to expose the actual source label it resolved to");
assert.equal(sourceScrollToTop, 286, `expected same-document fallback jump to keep centering the resolved source card, got ${sourceScrollToTop}`);

console.log("qa-citation-same-doc-fallback-regression passed");
