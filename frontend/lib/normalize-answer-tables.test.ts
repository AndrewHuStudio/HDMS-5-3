import { describe, expect, it } from "vitest";

import { normalizeAnswerTables } from "./normalize-answer-tables";

describe("normalizeAnswerTables", () => {
  it("converts a simple HTML <table> into a GFM markdown table", () => {
    const input =
      [
        "专项目管控要求：",
        "<table><thead><tr><th>地块类型</th><th>充电设施</th></tr></thead><tbody><tr><td>住宅混合用地</td><td>充电桩≥30%+全预留</td></tr></tbody></table>",
        "数据来源：[1-1](#source-1-1)",
      ].join("\n");

    const out = normalizeAnswerTables(input);

    expect(out).not.toContain("<table");
    expect(out).toContain("| 地块类型 | 充电设施 |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| 住宅混合用地 | 充电桩≥30%+全预留 |");
  });

  it("leaves markdown-only content unchanged", () => {
    const input = "这是一段普通文字。\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(normalizeAnswerTables(input)).toBe(input);
  });
});

