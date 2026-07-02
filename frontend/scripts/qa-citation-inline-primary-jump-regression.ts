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

const target = {
  id: "source-assistant-qa-1-1-4",
  offsetHeight: 48,
  classList: createClassList(),
  getAttribute(name: string) {
    if (name === "data-citation-target-label") return "1-4";
    return null;
  },
  getBoundingClientRect: () => createRect(620, 48),
  scrollIntoView: () => {
    throw new Error("expected inline citation jump to prefer explicit chat scroller over native scrollIntoView");
  },
} as const;

const chatScroller = {
  scrollTop: 320,
  clientHeight: 680,
  getBoundingClientRect: () => createRect(0, 680),
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
  chatScrollContainer: chatScroller as unknown as HTMLElement,
  flashDurationMs: 0,
});

assert.equal(result.found, true, "expected citation jump to resolve target in inline mode");
assert.equal(result.usedContainer, "chat", "expected inline citation jump to use chat scroller as the primary scroll container");
assert.equal(result.resolvedLabel, "1-4", "expected citation jump to preserve resolved label when exact target exists");
assert.equal(chatScrollToTop, 624, `expected inline citation jump to center the source card inside the chat scroller, got ${chatScrollToTop}`);

console.log("qa-citation-inline-primary-jump-regression passed");
