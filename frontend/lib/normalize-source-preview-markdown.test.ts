import { describe, expect, it } from "vitest";

import { normalizeSourcePreviewMarkdown } from "./normalize-source-preview-markdown";

describe("normalizeSourcePreviewMarkdown", () => {
  it("converts HTML tables to GFM markdown tables instead of stripping them into run-on text", () => {
    const input =
      "<table><tr><th>列A</th><th>列B</th></tr><tr><td>1</td><td>2</td></tr></table>";
    const out = normalizeSourcePreviewMarkdown(input);

    expect(out).toContain("| 列A | 列B |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| 1 | 2 |");
    expect(out).not.toContain("<table");
  });

  it("keeps non-table HTML alone but strips broken table fragments", () => {
    const input = "正文<tr><td>坏片段</td></tr>更多正文";
    const out = normalizeSourcePreviewMarkdown(input);
    expect(out).toContain("正文");
    expect(out).toContain("坏片段");
    expect(out).toContain("更多正文");
    expect(out).not.toContain("<tr");
    expect(out).not.toContain("<td");
  });
});

