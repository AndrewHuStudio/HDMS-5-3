import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("thinking rendering mode", () => {
  it("does not inject thinking text into qa-panel answer markdown", () => {
    const text = readFileSync(resolve(__dirname, "qa-panel.tsx"), "utf8");
    expect(text).not.toContain("mergeThinkingIntoAnswer(");
  });

  it("does not inject thinking text into qa-new shell answer markdown", () => {
    const text = readFileSync(resolve(__dirname, "qa-new", "qa-shell.tsx"), "utf8");
    expect(text).not.toContain("mergeThinkingIntoAnswer(");
  });
});
