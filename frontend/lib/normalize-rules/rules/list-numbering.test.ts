import { describe, expect, it } from "vitest";

import { normalizeMarkdownLists } from "./list-numbering";

describe("normalizeMarkdownLists", () => {
  it("keeps ordered list numbering stable across image/figcaption interludes", () => {
    const input = [
      "1. 网络化公共系统：",
      "- 空中连廊串联形成慢行环网",
      "",
      "![参考图](/rag/documents/doc-1/image?ref=images/a.jpg)",
      "",
      "FIGCAPTION 图1：参考配图",
      "",
      "1. 刚性指标约束：",
      "- 地下空间退线（蓝色实线）",
      "1. 弹性设计引导：",
      "- 活跃功能界面分级",
    ].join("\n");

    const out = normalizeMarkdownLists(input);

    expect(out).toContain("1. 网络化公共系统：");
    expect(out).toContain("2. 刚性指标约束：");
    expect(out).toContain("3. 弹性设计引导：");
    expect(out).toContain("![参考图](/rag/documents/doc-1/image?ref=images/a.jpg)");
    expect(out).toContain("FIGCAPTION 图1：参考配图");
  });

  it("resets numbering after a heading boundary", () => {
    const input = [
      "1. 一级策略：",
      "- A",
      "1. 二级策略：",
      "- B",
      "",
      "## 新章节",
      "",
      "1. 重新开始：",
      "- C",
    ].join("\n");

    const out = normalizeMarkdownLists(input);

    expect(out).toContain("1. 一级策略：");
    expect(out).toContain("2. 二级策略：");
    expect(out).toContain("## 新章节");
    expect(out).toContain("1. 重新开始：");
  });

  it("renumbers bold-wrapped ordered section labels", () => {
    const input = [
      "**1. 合规核查重点**",
      "- 连廊系统是否满足要求",
      "",
      "**1．空间优化建议**",
      "- 在标高16.8m的空中连接体嵌入共享设施",
      "",
      "**1) 典型实施场景**",
      "- 十字形空中廊道系统",
    ].join("\n");

    const out = normalizeMarkdownLists(input);

    expect(out).toContain("**1. 合规核查重点**");
    expect(out).toContain("**2． 空间优化建议**");
    expect(out).toContain("**3) 典型实施场景**");
  });
});
