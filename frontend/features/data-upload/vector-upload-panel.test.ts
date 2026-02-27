import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("VectorUploadPanel table columns", () => {
  it("does not render a version column in the document list", () => {
    const source = readFileSync("features/data-upload/vector-upload-panel.tsx", "utf-8");

    expect(source).not.toContain(">版本<");
    expect(source).not.toContain("ing?.version");
  });
});
