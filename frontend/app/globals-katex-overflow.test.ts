import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const globalsCssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "globals.css");
const globalsCss = readFileSync(globalsCssPath, "utf8");

describe("katex overflow styles", () => {
  it("constrains display formulas inside QA answers", () => {
    expect(globalsCss).toMatch(/\.qa-markdown\s+\.katex-display/);
    expect(globalsCss).toMatch(/overflow-x:\s*auto/);
    expect(globalsCss).toMatch(/max-width:\s*100%/);
  });
});
