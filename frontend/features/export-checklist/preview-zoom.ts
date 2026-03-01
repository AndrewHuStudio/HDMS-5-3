export const PREVIEW_ZOOM_MIN = 50;
export const PREVIEW_ZOOM_MAX = 200;
export const PREVIEW_ZOOM_STEP = 10;
export const PREVIEW_ZOOM_DEFAULT = 100;

export function clampPreviewZoom(value: number) {
  if (!Number.isFinite(value)) return PREVIEW_ZOOM_DEFAULT;
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, Math.round(value)));
}

export function increasePreviewZoom(value: number) {
  return clampPreviewZoom(value + PREVIEW_ZOOM_STEP);
}

export function decreasePreviewZoom(value: number) {
  return clampPreviewZoom(value - PREVIEW_ZOOM_STEP);
}

export function resetPreviewZoom(_value?: number) {
  return PREVIEW_ZOOM_DEFAULT;
}
