import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("QAPanel tabs mounting strategy", () => {
  it("force-mounts chat tab to preserve scroll position across tab switches", () => {
    const p = resolve(__dirname, "qa-panel.tsx");
    const text = readFileSync(p, "utf8");
    expect(text).toContain('<TabsContent value="chat" forceMount');
  });

  it("does not force-mount materials tab to keep DOM compact", () => {
    const p = resolve(__dirname, "qa-panel.tsx");
    const text = readFileSync(p, "utf8");
    expect(text).not.toContain('<TabsContent value="materials" forceMount');
  });
});
