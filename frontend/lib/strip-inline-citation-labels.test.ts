import { describe, expect, it } from "vitest";

import { stripInlineCitationLabels } from "./strip-inline-citation-labels";

describe("stripInlineCitationLabels", () => {
  it("removes inline [N-M] citation markers from regular paragraphs", () => {
    const input = "执行双维度8项指标计算（1-1）并结合资料[1-3]与标准[2-1]完成判断。";
    const output = stripInlineCitationLabels(input);

    expect(output).toContain("执行双维度8项指标计算（1-1）并结合资料与标准完成判断。");
    expect(output).not.toContain("[1-3]");
    expect(output).not.toContain("[2-1]");
  });

  it("cleans empty parentheses left by removed citations", () => {
    const input = "对照达标判断流程（[1-2]）并形成结论。";
    const output = stripInlineCitationLabels(input);

    expect(output).toBe("对照达标判断流程并形成结论。");
  });

  it("does not modify inline code or fenced code blocks", () => {
    const input = [
      "正文引用[1-1]应被移除。",
      "`示例 [2-1] 保留`",
      "```md",
      "代码块 [3-1] 保留",
      "```",
    ].join("\n");

    const output = stripInlineCitationLabels(input);

    expect(output).toContain("正文引用应被移除。");
    expect(output).toContain("`示例 [2-1] 保留`");
    expect(output).toContain("代码块 [3-1] 保留");
  });
});
