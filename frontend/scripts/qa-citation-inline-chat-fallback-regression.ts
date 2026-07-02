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
  id: "source-assistant-qa-1-1-3",
  offsetHeight: 56,
  classList: createClassList(),
  getBoundingClientRect: () => createRect(640, 56),
  scrollIntoView: () => {
    throw new Error("expected inline citation jump to use chat scroller fallback");
  },
} as const;

const sourceScroller = {
  scrollTop: 0,
  scrollHeight: 200,
  clientHeight: 400,
  getBoundingClientRect: () => createRect(940, 400),
  scrollTo: ({ top }: { top: number }) => {
    sourceScrollToTop = top;
  },
} as const;

const chatScroller = {
  scrollTop: 420,
  scrollHeight: 1800,
  clientHeight: 700,
  getBoundingClientRect: () => createRect(0, 700),
  scrollTo: ({ top }: { top: number }) => {
    chatScrollToTop = top;
  },
} as const;

const result = jumpToCitationSource({
  label: "1-3",
  messageId: "assistant:qa:1",
  documentRef: {
    getElementById(id: string) {
      if (id === "source-assistant-qa-1-1-3") return target as unknown as HTMLElement;
      return null;
    },
  },
  sourceScrollContainer: sourceScroller as unknown as HTMLElement,
  chatScrollContainer: chatScroller as unknown as HTMLElement,
  flashDurationMs: 0,
});

assert.equal(result.found, true, "expected inline citation jump to resolve target");
assert.equal(result.usedContainer, "chat", "expected inline citation jump to fall back to chat scroller when source panel is not scrollable");
assert.equal(sourceScrollToTop, null, "expected non-scrollable inline source container to stay untouched");
assert.equal(chatScrollToTop, 738, `expected chat scroller to center target card, got ${chatScrollToTop}`);

console.log("qa-citation-inline-chat-fallback-regression passed");
