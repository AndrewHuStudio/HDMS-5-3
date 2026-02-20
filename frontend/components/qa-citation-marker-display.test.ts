import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("qa answer citation marker display", () => {
  it("strips inline citation markers in qa-panel answer rendering pipeline", () => {
    const text = readFileSync(resolve(__dirname, "qa-panel.tsx"), "utf8");

    expect(text).toContain('import { stripInlineCitationLabels } from "@/lib/strip-inline-citation-labels";');
    expect(text).toContain("stripInlineCitationLabels(withAnchors)");
  });

  it("strips inline citation markers in qa-new shell answer rendering pipeline", () => {
    const text = readFileSync(resolve(__dirname, "qa-new", "qa-shell.tsx"), "utf8");

    expect(text).toContain('import { stripInlineCitationLabels } from "@/lib/strip-inline-citation-labels";');
    expect(text).toContain("stripInlineCitationLabels(withAnchors)");
  });
});
