import { describe, expect, it, vi } from "vitest";

import { clearHighlightsPreservingScroll, restoreScrollTop } from "./pdf-viewer-scroll";

describe("pdf-viewer-scroll", () => {
  it("restoreScrollTop resets scrollTop over multiple animation frames", async () => {
    vi.useFakeTimers();

    const el = { scrollTop: 123 };
    const rafSpy = vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).requestAnimationFrame = rafSpy;

    // Simulate something else changing scrollTop.
    el.scrollTop = 999;
    restoreScrollTop(el as never, 123, 2);

    expect(el.scrollTop).toBe(123);
    await vi.advanceTimersByTimeAsync(0);
    expect(el.scrollTop).toBe(123);
    expect(rafSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("clearHighlightsPreservingScroll keeps the viewer scroll position stable when clearing", async () => {
    vi.useFakeTimers();

    const el = { scrollTop: 456 };
    const rafSpy = vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).requestAnimationFrame = rafSpy;

    const clearHighlights = vi.fn(() => {
      // Simulate the viewer snapping to a different place while clearing highlights.
      el.scrollTop = 0;
    });

    clearHighlightsPreservingScroll({
      viewerEl: el as never,
      clearHighlights,
      frames: 2,
    });

    expect(clearHighlights).toHaveBeenCalledTimes(1);
    expect(el.scrollTop).toBe(456);
    await vi.advanceTimersByTimeAsync(0);
    expect(el.scrollTop).toBe(456);
    expect(rafSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

