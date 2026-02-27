import { describe, expect, it } from "vitest";
import {
  shouldRenderFeatureVisuals,
  shouldRenderSetbackRateVisuals,
} from "@/lib/scene-visibility";

describe("scene visibility helpers", () => {
  it("hides feature visuals when toggle is off", () => {
    expect(shouldRenderFeatureVisuals(false, 3)).toBe(false);
  });

  it("hides feature visuals when there are no results", () => {
    expect(shouldRenderFeatureVisuals(true, 0)).toBe(false);
  });

  it("shows feature visuals only when toggle is on and there are results", () => {
    expect(shouldRenderFeatureVisuals(true, 2)).toBe(true);
  });

  it("uses the setback toggle to control all setback-rate visuals", () => {
    expect(shouldRenderSetbackRateVisuals(false)).toBe(false);
    expect(shouldRenderSetbackRateVisuals(true)).toBe(true);
  });
});
