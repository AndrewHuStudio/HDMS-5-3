import assert from "node:assert/strict";
import {
  buildCitationOriginId,
  buildCitationSourcePanelScrollerId,
  jumpToCitationOrigin,
  jumpToCitationSource,
} from "../features/qa/citation-engine/core";

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

const scopedOriginId = buildCitationOriginId({
  messageId: "assistant:qa:1",
  label: "1-4",
  instanceId: ":R1f:",
});

assert.equal(
  scopedOriginId,
  "citation-origin-assistant-qa-1-1-4-R1f",
  `expected origin anchor id to be DOM-safe, got ${scopedOriginId}`,
);

assert.equal(
  buildCitationSourcePanelScrollerId("assistant:qa:1"),
  "citation-source-list-assistant-qa-1",
  "expected sidebar source scroller id to stay DOM-safe and message-scoped",
);

let sourceScrollToTop: number | null = null;
let chatScrollToTop: number | null = null;
let originScrollCalls = 0;

const targetClassList = createClassList();
const originClassList = createClassList();

const sourceScroller = {
  scrollTop: 120,
  clientHeight: 300,
  getBoundingClientRect: () => createRect(100, 300),
  scrollTo: ({ top }: { top: number }) => {
    sourceScrollToTop = top;
  },
} as const;

const chatScroller = {
  scrollTop: 480,
  clientHeight: 720,
  getBoundingClientRect: () => createRect(0, 720),
  scrollTo: ({ top }: { top: number }) => {
    chatScrollToTop = top;
  },
} as const;

const targetElement = {
  offsetHeight: 60,
  classList: targetClassList,
  getBoundingClientRect: () => createRect(460, 60),
  scrollIntoView: () => {
    throw new Error("expected sidebar jump to use source scroller, not native scrollIntoView");
  },
} as const;

const originElement = {
  classList: originClassList,
  scrollIntoView: () => {
    originScrollCalls += 1;
  },
} as const;

const documentRef = {
  getElementById(id: string) {
    if (id === "source-assistant-qa-1-1-4") return targetElement as unknown as HTMLElement;
    if (id === scopedOriginId) return originElement as unknown as HTMLElement;
    return null;
  },
};

const sourceJump = jumpToCitationSource({
  label: "1-4",
  messageId: "assistant-qa-1",
  documentRef,
  chatScrollContainer: chatScroller as unknown as HTMLElement,
  sourceScrollContainer: sourceScroller as unknown as HTMLElement,
  flashDurationMs: 0,
});

assert.equal(sourceJump.found, true, "expected source jump to resolve a target");
assert.equal(sourceJump.usedContainer, "source", "expected sidebar jump to use source scroller");
assert.equal(chatScrollToTop, null, "expected chat scroller to remain untouched for sidebar source jumps");
assert.equal(
  sourceScrollToTop,
  360,
  `expected sidebar scroller to center the selected source card, got ${sourceScrollToTop}`,
);
assert.equal(targetClassList.has("qa-source-flash"), false, "expected flash class to be cleaned up when duration is 0");

const backToOrigin = jumpToCitationOrigin({
  originId: scopedOriginId,
  fallbackScrollTop: 512,
  documentRef,
  chatScrollContainer: chatScroller as unknown as HTMLElement,
  flashDurationMs: 0,
});

assert.equal(backToOrigin, true, "expected jump-back action to succeed when origin anchor exists");
assert.equal(originScrollCalls, 1, "expected jump-back action to scroll the original citation anchor into view");
assert.equal(chatScrollToTop, null, "expected jump-back action not to fall back to chat scroll when origin anchor exists");
assert.equal(originClassList.has("qa-source-flash"), false, "expected origin flash class to be cleaned up when duration is 0");

const fallbackToScrollTop = jumpToCitationOrigin({
  originId: "missing-origin",
  fallbackScrollTop: 640,
  documentRef,
  chatScrollContainer: chatScroller as unknown as HTMLElement,
  flashDurationMs: 0,
});

assert.equal(fallbackToScrollTop, true, "expected missing origin anchor to fall back to chat scroll position");
assert.equal(chatScrollToTop, 640, `expected fallback jump-back to restore chat scrollTop, got ${chatScrollToTop}`);

console.log("qa-citation-jump-regression passed");
