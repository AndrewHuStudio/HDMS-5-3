import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("vector panel layout", () => {
  it("shows a progress column in vector ingestion table", () => {
    const text = readFileSync(resolve(__dirname, "vector-upload-panel.tsx"), "utf8");
    expect(text).toContain(">进度<");
    expect(text).toContain("getVectorProgressValue");
    expect(text).toContain("<Progress value={progressValue}");
    expect(text).toContain("{progressValue}%");
  });
});
