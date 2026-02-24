import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("globals.css scrollbar gutter", () => {
  it("reserves scrollbar gutter for qa-scrollbar to prevent layout jitter when scrollbars appear/disappear", () => {
    const p = resolve(__dirname, "globals.css");
    const text = readFileSync(p, "utf8");
    expect(text).toContain("scrollbar-gutter: stable");
  });
});

