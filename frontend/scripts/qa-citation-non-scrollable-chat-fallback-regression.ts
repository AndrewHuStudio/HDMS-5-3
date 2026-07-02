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

let chatScrollToTop: number | null = null;
let nativeScrollCalls = 0;

const chatScroller = {
  scrollTop: 0,
  scrollHeight: 700,
  clientHeight: 700,
  parentElement: null,
  contains(element: unknown) {
    return element === target;
  },
  getBoundingClientRect: () => createRect(0, 700),
  scrollTo: ({ top }: { top: number }) => {
    chatScrollToTop = top;
  },
} as const;

const target = {
  id: "source-assistant-qa-1-1-4",
  offsetHeight: 56,
  parentElement: chatScroller,
  classList: createClassList(),
  getAttribute(name: string) {
    if (name === "data-citation-target-label") return "1-4";
    return null;
  },
  getBoundingClientRect: () => createRect(940, 56),
  scrollIntoView: (options?: ScrollIntoViewOptions) => {
    nativeScrollCalls += 1;
    assert.deepEqual(
      options,
      { behavior: "smooth", block: "center" },
      "expected native fallback to center the source card",
    );
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
  chatScrollContainer: chatScroller as unknown as HTMLElement,
  flashDurationMs: 0,
});

assert.equal(result.found, true, "expected citation jump to resolve the source card");
assert.equal(
  chatScrollToTop,
  null,
  "expected citation jump not to scroll a containing chat element that cannot actually scroll",
);
assert.equal(nativeScrollCalls, 1, "expected citation jump to use native scroll fallback");
assert.equal(
  result.usedContainer,
  "native",
  `expected citation jump to report native fallback, got ${result.usedContainer}`,
);

console.log("qa-citation-non-scrollable-chat-fallback-regression passed");
