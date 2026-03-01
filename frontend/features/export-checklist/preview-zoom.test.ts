import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPreviewZoom,
  decreasePreviewZoom,
  increasePreviewZoom,
  PREVIEW_ZOOM_MAX,
  PREVIEW_ZOOM_DEFAULT,
  PREVIEW_ZOOM_MIN,
  PREVIEW_ZOOM_STEP,
  resetPreviewZoom,
} from "./preview-zoom";

test("clampPreviewZoom keeps values inside min and max", () => {
  assert.equal(clampPreviewZoom(PREVIEW_ZOOM_MIN - 10), PREVIEW_ZOOM_MIN);
  assert.equal(clampPreviewZoom(PREVIEW_ZOOM_MAX + 10), PREVIEW_ZOOM_MAX);
  assert.equal(clampPreviewZoom(100), 100);
});

test("increasePreviewZoom increases by step and respects max", () => {
  assert.equal(increasePreviewZoom(100), 100 + PREVIEW_ZOOM_STEP);
  assert.equal(increasePreviewZoom(PREVIEW_ZOOM_MAX), PREVIEW_ZOOM_MAX);
});

test("decreasePreviewZoom decreases by step and respects min", () => {
  assert.equal(decreasePreviewZoom(100), 100 - PREVIEW_ZOOM_STEP);
  assert.equal(decreasePreviewZoom(PREVIEW_ZOOM_MIN), PREVIEW_ZOOM_MIN);
});

test("resetPreviewZoom always returns default value", () => {
  assert.equal(resetPreviewZoom(130), PREVIEW_ZOOM_DEFAULT);
  assert.equal(resetPreviewZoom(PREVIEW_ZOOM_MIN), PREVIEW_ZOOM_DEFAULT);
  assert.equal(resetPreviewZoom(PREVIEW_ZOOM_MAX), PREVIEW_ZOOM_DEFAULT);
});
