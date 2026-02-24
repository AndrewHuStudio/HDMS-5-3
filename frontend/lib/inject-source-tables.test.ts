import { describe, expect, it } from "vitest";

import type { SourceInfo } from "@/features/qa/types";
import { injectSourceTables } from "./inject-source-tables";

describe("injectSourceTables", () => {
  it("strips (见表N) when no sources contain tables", () => {
    const sources: SourceInfo[] = [
      { type: "document", name: "a.pdf", source: "vector_search", citation_label: "1-1", quote: "普通文本" },
    ];
    expect(injectSourceTables("这里需要对照(见表1)。", sources)).toBe("这里需要对照。");
  });

  it("appends a related tables section when (见表N) is present and a table exists in sources", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        quote: [
          "表3.2.6 指标对照表",
          "| 指标 | 说明 |",
          "| --- | --- |",
          "| A | a |",
        ].join("\n"),
      },
    ];
    const out = injectSourceTables("指标如下(见表1)。", sources);
    expect(out).toContain("### 相关表格");
    expect(out).toContain("表1：相关表格");
    expect(out).toContain("| 指标 | 说明 |");
  });
});

