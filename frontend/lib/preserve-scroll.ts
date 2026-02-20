export type PreserveScrollOptions = {
  doc?: Document;
  selector?: string;
  raf?: (cb: () => void) => void;
  /**
   * Optional timeout helper (primarily for tests); defaults to `window.setTimeout`.
   */
  timeout?: (cb: () => void, ms: number) => void;
};

/**
 * Capture scrollTop for a set of scroll containers and restore them later.
 *
 * Used to avoid "scroll jumping" caused by focus restoration / scroll anchoring
 * when opening/closing overlay components (PDF viewer, lightboxes, etc).
 */
export function preserveScrollPositions(options: PreserveScrollOptions = {}): () => void {
  const doc = options.doc ?? document;
  const selector = options.selector ?? ".qa-scrollbar";
  const raf =
    options.raf ??
    (typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: () => void) => cb());
  const timeout =
    options.timeout ??
    ((cb: () => void, ms: number) => {
      window.setTimeout(cb, ms);
    });

  const els = Array.from(doc.querySelectorAll<HTMLElement>(selector));
  const saved = new Map<HTMLElement, number>();
  for (const el of els) {
    saved.set(el, el.scrollTop);
  }

  return () => {
    const restoreOnce = () => {
      for (const [el, top] of saved.entries()) {
        if (doc.contains(el)) {
          el.scrollTop = top;
        }
      }
    };

    // Restore multiple times across frames/timers.
    // In practice, the jump can happen after the overlay unmounts because of
    // focus restoration, async layout, or scroll anchoring.
    restoreOnce();
    raf(restoreOnce);
    raf(() => raf(restoreOnce));
    timeout(restoreOnce, 0);
    timeout(restoreOnce, 50);
  };
}
