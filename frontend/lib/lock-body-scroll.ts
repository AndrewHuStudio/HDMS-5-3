export type BodyScrollLockOptions = {
  doc?: Document;
  win?: Window;
};

function parsePx(value: string | null | undefined): number {
  const raw = String(value ?? "").trim();
  const m = raw.match(/^(-?\d+(?:\.\d+)?)px$/i);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lock page scroll without causing layout "jump" due to scrollbar removal.
 *
 * This is intentionally implemented without relying on external libs so it
 * remains stable across our Next.js + fixed-overlay layouts.
 */
export function lockBodyScroll(options: BodyScrollLockOptions = {}): () => void {
  const doc = options.doc ?? document;
  const win = options.win ?? window;

  const body = doc.body;
  const html = doc.documentElement;

  const prevOverflow = body.style.overflow;
  const prevPaddingRight = body.style.paddingRight;

  // Reserve scrollbar gutter width as padding so content width doesn't shift.
  const scrollbarWidth = Math.max(0, (win.innerWidth || 0) - (html?.clientWidth || 0));
  const computedPaddingRight = (() => {
    try {
      return parsePx(win.getComputedStyle(body).paddingRight);
    } catch {
      return 0;
    }
  })();

  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
  }

  return () => {
    body.style.overflow = prevOverflow;
    body.style.paddingRight = prevPaddingRight;
  };
}

