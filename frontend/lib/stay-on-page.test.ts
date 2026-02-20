import { describe, expect, it, vi } from "vitest";

import { highlightAndStayOnPage } from "./stay-on-page";

describe("highlightAndStayOnPage", () => {
  it("calls jumpToPage after highlight resolves (and again on next frame) to undo search auto-jump", async () => {
    vi.useFakeTimers();

    // In Node env, provide a RAF shim so the helper can schedule a "next frame" follow-up jump.
    const rafSpy = vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).requestAnimationFrame = rafSpy;

    const highlight = vi.fn(async () => [{ pageIndex: 3 }]);
    const jumpToPage = vi.fn();

    const promise = highlightAndStayOnPage({
      keyword: "foo",
      highlight,
      jumpToPage,
      stayOnPageIndex: 16,
    });

    // Immediate jump happens after highlight resolves and the RAF callback runs on next timer tick.
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    const matches = await promise;

    expect(matches).toEqual([{ pageIndex: 3 }]);
    expect(highlight).toHaveBeenCalledWith("foo");
    expect(jumpToPage).toHaveBeenCalledWith(16);
    expect(jumpToPage).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("works even if jumpToPage is not provided", async () => {
    const highlight = vi.fn(async () => [{ pageIndex: 0 }]);
    const matches = await highlightAndStayOnPage({
      keyword: "bar",
      highlight,
      stayOnPageIndex: 0,
    });
    expect(matches).toEqual([{ pageIndex: 0 }]);
  });
});
