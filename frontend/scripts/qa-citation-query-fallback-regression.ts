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

let querySelectorCalls = 0;
let sourceScrollToTop: number | null = null;

const target = {
  id: "source-fallback-target",
  offsetHeight: 48,
  classList: createClassList(),
  getBoundingClientRect: () => createRect(420, 48),
  scrollIntoView: () => {
    throw new Error("expected fallback lookup to keep using source scroller");
  },
} as const;

const sourceScroller = {
  scrollTop: 90,
  clientHeight: 280,
  getBoundingClientRect: () => createRect(100, 280),
  scrollTo: ({ top }: { top: number }) => {
    sourceScrollToTop = top;
  },
} as const;

const result = jumpToCitationSource({
  label: "1-4",
  messageId: "assistant:qa:1",
  documentRef: {
    getElementById() {
      return null;
    },
    querySelector() {
      querySelectorCalls += 1;
      return target as unknown as Element;
    },
  },
  sourceScrollContainer: sourceScroller as unknown as HTMLElement,
  flashDurationMs: 0,
});

assert.equal(querySelectorCalls > 0, true, "expected source jump to fall back to querySelector lookup");
assert.equal(result.found, true, "expected source jump to resolve fallback target when exact id is missing");
assert.equal(result.targetId, "source-fallback-target", "expected source jump to use the fallback target element");
assert.equal(sourceScrollToTop, 294, `expected fallback source jump to keep centering selected card, got ${sourceScrollToTop}`);

console.log("qa-citation-query-fallback-regression passed");
