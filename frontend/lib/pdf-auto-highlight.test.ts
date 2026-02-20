import { describe, expect, it, vi } from "vitest";

import {
  buildPdfSearchCandidates,
  resolvePdfSearchKeyword,
  scheduleAutoPdfHighlight,
} from "./pdf-auto-highlight";

describe("buildPdfSearchCandidates", () => {
  it("prefers cleaned quote text and returns decreasing-length candidates", () => {
    const cands = buildPdfSearchCandidates({
      quote: "这是一个测试段落（含标点），用于高亮定位。\n下一行。",
      query: "后海片区的容积率是多少？",
    });
    // Should be non-empty and not contain punctuation-only noise
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]).toMatch(/测试段落/);
    // Should include a shorter fallback
    expect(cands.some((c) => c.length < cands[0].length)).toBe(true);
  });
});

describe("scheduleAutoPdfHighlight", () => {
  it("tries candidates until a match is found, then clears highlights after the configured duration", async () => {
    vi.useFakeTimers();

    const highlight = vi.fn(async (kw: string) => {
      // Only the 2nd candidate will match
      return kw === "第二候选词" ? ([{ pageIndex: 0 }] as unknown[]) : ([] as unknown[]);
    });
    const clearHighlights = vi.fn();

    const candidates = ["第一候选词", "第二候选词"];
    const cleanup = scheduleAutoPdfHighlight({
      candidates,
      highlight,
      clearHighlights,
      delayMs: 100,
      clearAfterMs: 250,
    });

    // Before delay: nothing happens
    expect(highlight).not.toHaveBeenCalled();

    // Trigger delayed highlight
    await vi.advanceTimersByTimeAsync(100);
    expect(highlight).toHaveBeenCalledTimes(2);
    expect(highlight).toHaveBeenNthCalledWith(1, "第一候选词");
    expect(highlight).toHaveBeenNthCalledWith(2, "第二候选词");

    // Clear after duration
    expect(clearHighlights).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(clearHighlights).toHaveBeenCalledTimes(1);

    cleanup();
    vi.useRealTimers();
  });
});

describe("resolvePdfSearchKeyword", () => {
  it("prefers source.quote, then fallback text, then section", () => {
    expect(
      resolvePdfSearchKeyword(
        { quote: "  来自引用  ", section: "章节标题" } as never,
        "预览文本",
      ),
    ).toBe("来自引用");
    expect(
      resolvePdfSearchKeyword(
        { quote: "", section: "章节标题" } as never,
        "  预览文本  ",
      ),
    ).toBe("预览文本");
    expect(
      resolvePdfSearchKeyword(
        { quote: "", section: "  章节标题 " } as never,
        "",
      ),
    ).toBe("章节标题");
  });
});
