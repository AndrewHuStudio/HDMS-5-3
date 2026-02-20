type RestoreFrames = 1 | 2;

export function restoreScrollTop(
  viewerEl: HTMLElement | null | undefined,
  savedTop: number | undefined,
  frames: RestoreFrames = 2,
): void {
  if (!viewerEl || savedTop === undefined) return;

  viewerEl.scrollTop = savedTop;

  const applyFrame = (remaining: number) => {
    requestAnimationFrame(() => {
      viewerEl.scrollTop = savedTop;
      if (remaining > 1) {
        applyFrame(remaining - 1);
      }
    });
  };

  applyFrame(frames);
}

type ClearHighlightsPreservingScrollArgs = {
  viewerEl: HTMLElement | null | undefined;
  clearHighlights: () => void;
  frames?: RestoreFrames;
};

export function clearHighlightsPreservingScroll(args: ClearHighlightsPreservingScrollArgs): void {
  const { viewerEl, clearHighlights, frames = 2 } = args;
  const savedTop = viewerEl?.scrollTop;
  clearHighlights();
  restoreScrollTop(viewerEl, savedTop, frames);
}

