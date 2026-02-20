import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("qa markdown table visual style", () => {
  it("uses table wrapper class in qa-panel and qa shell markdown renderers", () => {
    const panelText = readFileSync(resolve(__dirname, "qa-panel.tsx"), "utf8");
    const shellText = readFileSync(resolve(__dirname, "qa-new", "qa-shell.tsx"), "utf8");

    expect(panelText).toContain("qa-table-wrap");
    expect(shellText).toContain("qa-table-wrap");
  });

  it("hides stray horizontal rules that appear immediately after tables", () => {
    const css = readFileSync(resolve(__dirname, "..", "app", "globals.css"), "utf8");

    expect(css).toContain(".qa-markdown .qa-table-wrap + hr");
    expect(css).toContain("display: none");
  });
});
