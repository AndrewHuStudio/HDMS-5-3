import assert from "node:assert/strict";

function clampAssistantPanelWidth(viewportWidth: number, pointerX: number): number {
  const MIN_WIDTH = 360;
  const MAX_WIDTH = 720;
  const raw = viewportWidth - pointerX;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));
}

assert.equal(
  clampAssistantPanelWidth(1920, 1500),
  420,
  "expected natural drag distance to preserve direct width mapping inside range",
);

assert.equal(
  clampAssistantPanelWidth(1920, 1800),
  360,
  "expected width to clamp at minimum size",
);

assert.equal(
  clampAssistantPanelWidth(1920, 900),
  720,
  "expected width to clamp at maximum size",
);

console.log("qa-assistant-panel-width-regression passed");
