import { describe, expect, it } from "vitest";
import { resolveThinkingHeaderState } from "./qa-thinking-status";

describe("resolveThinkingHeaderState", () => {
  it("shows thinking state while streaming and not done", () => {
    expect(
      resolveThinkingHeaderState({
        isStreaming: true,
        thinkingDone: false,
        hasThinkingTokens: false,
      }),
    ).toBe("thinking");
  });

  it("keeps thinking state while tokens are still streaming", () => {
    expect(
      resolveThinkingHeaderState({
        isStreaming: true,
        thinkingDone: false,
        hasThinkingTokens: true,
      }),
    ).toBe("thinking");
  });

  it("switches to history state when thinking_done arrives", () => {
    expect(
      resolveThinkingHeaderState({
        isStreaming: true,
        thinkingDone: true,
        hasThinkingTokens: true,
      }),
    ).toBe("history");
  });

  it("switches to history state when stream ends with thinking text", () => {
    expect(
      resolveThinkingHeaderState({
        isStreaming: false,
        thinkingDone: false,
        hasThinkingTokens: true,
      }),
    ).toBe("history");
  });
});
