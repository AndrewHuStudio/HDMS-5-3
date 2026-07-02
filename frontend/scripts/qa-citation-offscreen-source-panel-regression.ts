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

let sourceScrollToTop: number | null = null;
let chatScrollToTop: number | null = null;

const target = {
  id: "source-assistant-qa-1-1-4",
  offsetHeight: 64,
  classList: createClassList(),
  getBoundingClientRect: () => createRect(1160, 64),
  scrollIntoView: () => {
    throw new Error("expected citation jump to avoid native scrollIntoView when explicit containers are available");
  },
} as const;

const sourceScroller = {
  scrollTop: 120,
  scrollHeight: 1600,
  clientHeight: 280,
  getBoundingClientRect: () => createRect(980, 280),
  scrollTo: ({ top }: { top: number }) => {
    sourceScrollToTop = top;
  },
} as const;

const chatScroller = {
  scrollTop: 360,
  scrollHeight: 2400,
  clientHeight: 720,
  getBoundingClientRect: () => createRect(0, 720),
  scrollTo: ({ top }: { top: number }) => {
    chatScrollToTop = top;
  },
} as const;

const result = jumpToCitationSource({
  label: "1-4",
  messageId: "assistant:qa:1",
  documentRef: {
    getElementById(id: string) {
      if (id === "source-assistant-qa-1-1-4") return target as unknown as HTMLElement;
      return null;
    },
  },
  sourceScrollContainer: sourceScroller as unknown as HTMLElement,
  chatScrollContainer: chatScroller as unknown as HTMLElement,
  flashDurationMs: 0,
});

assert.equal(result.found, true, "expected citation jump to resolve the source target");
assert.equal(
  sourceScrollToTop,
  192,
  `expected source panel to scroll its own list to the selected source card, got ${sourceScrollToTop}`,
);
assert.equal(
  chatScrollToTop,
  1120,
  `expected chat scroller to also reveal the offscreen source panel itself, got ${chatScrollToTop}`,
);
assert.equal(
  result.usedContainer,
  "source",
  "expected source panel to remain the primary scroll container when it has its own scroller",
);

console.log("qa-citation-offscreen-source-panel-regression passed");
