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

let wrongChatScrollToTop: number | null = null;
let realChatScrollToTop: number | null = null;

const wrongChatScroller = {
  scrollTop: 0,
  scrollHeight: 700,
  clientHeight: 700,
  parentElement: null,
  getBoundingClientRect: () => createRect(0, 700),
  scrollTo: ({ top }: { top: number }) => {
    wrongChatScrollToTop = top;
  },
} as const;

const realChatScroller = {
  scrollTop: 360,
  scrollHeight: 1800,
  clientHeight: 700,
  parentElement: null,
  getBoundingClientRect: () => createRect(0, 700),
  scrollTo: ({ top }: { top: number }) => {
    realChatScrollToTop = top;
  },
} as const;

const target = {
  id: "source-assistant-qa-1-1-4",
  offsetHeight: 56,
  parentElement: realChatScroller,
  classList: createClassList(),
  getAttribute(name: string) {
    if (name === "data-citation-target-label") return "1-4";
    return null;
  },
  getBoundingClientRect: () => createRect(940, 56),
  scrollIntoView: () => {
    throw new Error("expected citation jump to use nearest scroll parent instead of native scrollIntoView");
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
  chatScrollContainer: wrongChatScroller as unknown as HTMLElement,
  flashDurationMs: 0,
});

assert.equal(result.found, true, "expected citation jump to resolve the exact source item");
assert.equal(
  wrongChatScrollToTop,
  null,
  "expected citation jump not to scroll a non-ancestor chat container",
);
assert.equal(
  realChatScrollToTop,
  978,
  `expected citation jump to scroll the source item's nearest scroll parent, got ${realChatScrollToTop}`,
);
assert.equal(
  result.usedContainer,
  "nearest",
  `expected citation jump to report nearest scroll parent, got ${result.usedContainer}`,
);

console.log("qa-citation-nearest-scroll-parent-regression passed");
