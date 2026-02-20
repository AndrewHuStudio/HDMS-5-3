import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("RootLayout PDF viewer CSS imports", () => {
  it("imports @react-pdf-viewer/search styles so highlights can render correctly", () => {
    const p = resolve(__dirname, "layout.tsx");
    const text = readFileSync(p, "utf8");
    expect(text).toContain('@react-pdf-viewer/search/lib/styles/index.css');
  });
});

