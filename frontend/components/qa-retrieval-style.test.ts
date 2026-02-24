import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("retrieval analysis list style", () => {
  it("highlights only retrieval document names in qa-panel", () => {
    const text = readFileSync(resolve(__dirname, "qa-panel.tsx"), "utf8");
    expect(text).toContain('const isRetrievalReason = plainText.startsWith("资料调用理由（");');
    expect(text).toContain('const isRetrievalList = plainText.startsWith("检索资料清单");');
    expect(text).toContain("highlightRetrievalDocNames(children");
    expect(text).toContain("italic text-sky-600/80");
  });

  it("highlights only retrieval document names in qa-new shell", () => {
    const text = readFileSync(resolve(__dirname, "qa-new", "qa-shell.tsx"), "utf8");
    expect(text).toContain('const isRetrievalReason = plainText.startsWith("资料调用理由（");');
    expect(text).toContain('const isRetrievalList = plainText.startsWith("检索资料清单");');
    expect(text).toContain("highlightRetrievalDocNames(children");
    expect(text).toContain("italic text-sky-600/80");
  });
});
