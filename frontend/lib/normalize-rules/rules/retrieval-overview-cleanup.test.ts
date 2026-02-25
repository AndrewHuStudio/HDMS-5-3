import { describe, expect, it } from "vitest";

import { runNormalizationPipeline } from "../index";

describe("retrieval overview cleanup", () => {
  it("removes retrieval stats and non-container prose under 检索综述", () => {
    const input = [
      "## 检索综述",
      "",
      "已检索 5 条候选，融合 5 条结果。",
      "",
      "> 检索资料清单与引用分析：检索资料清单：①DU06-05-1；②DU06-05-2。",
      "",
      "立体空间开发控制是城市高密度核心区通过三维规划手段。",
      "",
      "## 一、核心内涵",
      "",
      "正文内容。",
    ].join("\n");

    const out = runNormalizationPipeline(input, { phase: "finalizing" });

    expect(out).not.toContain("已检索 5 条候选，融合 5 条结果");
    expect(out).toContain("> 检索资料清单与引用分析");
    expect(out).not.toContain("立体空间开发控制是城市高密度核心区通过三维规划手段");
    expect(out).toContain("## 一、核心内涵");
    expect(out).toContain("正文内容。");
  });

  it("keeps detailed answer body when retrieval section reaches EOF", () => {
    const input = [
      "## 检索综述",
      "",
      "已检索 5 条候选，融合 5 条结果。",
      "",
      "> 检索资料清单与引用分析：检索资料清单：①DU06-05-1；②DU06-05-2。",
      "",
      "### 1. 核心内涵",
      "",
      "正文内容。",
    ].join("\n");

    const out = runNormalizationPipeline(input, { phase: "finalizing" });

    expect(out).not.toContain("已检索 5 条候选，融合 5 条结果");
    expect(out).toContain("> 检索资料清单与引用分析");
    expect(out).toContain("## 详细解析");
    expect(out).toContain("### 1. 核心内涵");
    expect(out).toContain("正文内容。");
  });
});
