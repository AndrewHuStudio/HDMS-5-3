import { describe, expect, it } from "vitest";

import { normalizeAnswerMarkdownArtifacts } from "./normalize-answer-markdown-artifacts";

describe("normalizeAnswerMarkdownArtifacts", () => {
  it("normalizes fullwidth asterisks so **bold** renders", () => {
    expect(normalizeAnswerMarkdownArtifacts("＊＊公共性用地占比≥54%＊＊")).toBe(
      "**公共性用地占比≥54%**"
    );
  });

  it("removes zero-width characters that can break markdown delimiters", () => {
    expect(normalizeAnswerMarkdownArtifacts("**\u200B公共性用地占比≥54%\u200B**")).toBe(
      "**公共性用地占比≥54%**"
    );
  });

  it("tightens whitespace inside bold delimiters (common LLM artifact)", () => {
    expect(normalizeAnswerMarkdownArtifacts("** 公共性用地占比≥54% **")).toBe(
      "**公共性用地占比≥54%**"
    );
  });

  it("converts accidental GFM strikethrough in numeric ranges back to ~", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("地上容积率：通过3.3~~5.2~~（1分）")
    ).toBe("地上容积率：通过3.3~5.2（1分）");
  });

  it("converts ~~ used as a range delimiter between numeric tokens (prevents line-through spans)", () => {
    expect(
      normalizeAnswerMarkdownArtifacts(
        "地上容积率：基准区间3.3~~5.2（1分）/5.3~~7.3（2分）/≥7.4（3分）"
      )
    ).toBe("地上容积率：基准区间3.3~5.2（1分）/5.3~7.3（2分）/≥7.4（3分）");
  });

  it("normalizes numeric ranges with comparators and percentages without relying on fixed phrases", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("公共性用地占比：≥36~~54%（2分）；地下容积率：≤0.8~~1.2（2分）")
    ).toBe("公共性用地占比：≥36~54%（2分）；地下容积率：≤0.8~1.2（2分）");
  });

  it("normalizes range delimiters even when score notes are adjacent to the numbers", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("地上容积率基准段3.3~~5.2对应1分，5.3~~7.3对应2分，≥7.4得3分")
    ).toBe("地上容积率基准段3.3~5.2对应1分，5.3~7.3对应2分，≥7.4得3分");
  });

  it("does not rewrite ~~ inside inline code spans", () => {
    expect(normalizeAnswerMarkdownArtifacts("示例：`3.3~~5.2` 仅用于代码演示")).toBe(
      "示例：`3.3~~5.2` 仅用于代码演示"
    );
  });

  it("does not touch normal strikethrough text", () => {
    expect(normalizeAnswerMarkdownArtifacts("这是 ~~删除~~ 的示例")).toBe(
      "这是 ~~删除~~ 的示例"
    );
  });

  it("strips leaked <think> tags", () => {
    expect(normalizeAnswerMarkdownArtifacts("<think>reasoning</think>答案内容")).toBe(
      "reasoning答案内容"
    );
  });

  it("strips partial <think> tag at end of streaming chunk", () => {
    expect(normalizeAnswerMarkdownArtifacts("部分内容</think>后续")).toBe(
      "部分内容后续"
    );
  });

  it("inserts blank line before list items that follow a non-blank line", () => {
    expect(normalizeAnswerMarkdownArtifacts("标题内容\n- 列表项1\n- 列表项2")).toBe(
      "标题内容\n\n- 列表项1\n- 列表项2"
    );
  });

  it("inserts blank line before numbered list items", () => {
    expect(normalizeAnswerMarkdownArtifacts("说明如下\n1. 第一点\n2. 第二点")).toBe(
      "说明如下\n\n1. 第一点\n2. 第二点"
    );
  });

  it("does not double blank lines before lists that already have one", () => {
    expect(normalizeAnswerMarkdownArtifacts("标题内容\n\n- 列表项1")).toBe(
      "标题内容\n\n- 列表项1"
    );
  });

  it("converts Chinese heading 一、 to ## and ensures blank line after", () => {
    expect(normalizeAnswerMarkdownArtifacts("一、评估流程\n这是正文内容")).toBe(
      "## 一、评估流程\n\n这是正文内容"
    );
  });

  it("converts （一） to ### and fixes list numbering", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("（一）环境性能\n1. 绿地率\n1. 通风效率")
    ).toBe("### （一）环境性能\n\n1. 绿地率\n2. 通风效率");
  });

  it("converts top-level numeric section lines to heading while keeping index", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("1.开发强度管控\n- 指标A\n- 指标B")
    ).toBe("### 1. 开发强度管控\n\n- 指标A\n- 指标B");
  });

  it("splits inline numbered subitem accidentally glued to a heading line", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("二、核心指标测算1.避难容量：地下人防设施按30%折算有效面积。")
    ).toBe("## 二、核心指标测算\n\n1. 避难容量：地下人防设施按30%折算有效面积。");
  });

  it("keeps normal ordered list items as list instead of converting to heading", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("步骤如下\n1. 第一步\n2. 第二步")
    ).toBe("步骤如下\n\n1. 第一步\n2. 第二步");
  });

  it("renumbers duplicated ### heading indices to sequential order", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("### 1. 开发强度管控\n内容A\n### 1. 交通系统管控\n内容B")
    ).toBe("### 1. 开发强度管控\n\n内容A\n### 2. 交通系统管控\n\n内容B");
  });

  it("restarts numbered subsection headings in a new major section", () => {
    expect(
      normalizeAnswerMarkdownArtifacts(
        "## 一、流程A\n### 1. 第一步\n### 2. 第二步\n## 二、流程B\n### 6. 检索信息\n### 7. 排除依据"
      )
    ).toBe(
      "## 一、流程A\n\n### 1. 第一步\n\n### 2. 第二步\n\n## 二、流程B\n\n### 1. 检索信息\n\n### 2. 排除依据"
    );
  });

  it("normalizes bullet glyphs like • into markdown list marker '-'", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("### 1. 开发强度管控\n• 指标A\n• 指标B")
    ).toBe("### 1. 开发强度管控\n\n- 指标A\n- 指标B");
  });

  it("promotes inline '核心结论：' into top-level conclusion heading", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("### 4. 空间形态管控\n说明A。核心结论：这是结论内容。")
    ).toBe("### 4. 空间形态管控\n\n说明A。\n\n## 结论\n\n这是结论内容。");
  });

  it("does not duplicate conclusion heading when one already exists", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("## 结论\n这是已存在的结论。")
    ).toBe("## 结论\n\n这是已存在的结论。");
  });

  it("preserves inline figure references by default to keep paragraph readability", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("评估流程见图3.0.3，指标体系见图3.0.1")
    ).toBe("评估流程见图3.0.3，指标体系见图3.0.1");
  });

  it("normalizes table references to (见表N) and strips numeric section artifacts", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("指标见表3.2.6（3.2.6）。下一句（4.4说明）继续。")
    ).toBe("指标(见表1)。下一句继续。");
  });

  it("strips parenthesized clause references like （3.0.2第3款）", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("依据规范（3.0.2第3款）与（4.2.1第2条）进行判定。")
    ).toBe("依据规范与进行判定。");
  });

  it("removes dangling punctuation-only parentheses after section cleanup", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("根据《城市高强度片区界定与分类标准》（，），核心指标通过三维度构建。")
    ).toBe("根据《城市高强度片区界定与分类标准》，核心指标通过三维度构建。");
  });

  it("handles full LLM output with Chinese headings, lists, and figure refs", () => {
    const input = [
      "一、检索综述",
      "本次检索到3份资料。",
      "二、详细解析",
      "1. 第一点",
      "1. 第二点",
      "三、总结",
      "综合来看需要多维度考量。",
    ].join("\n");

    const output = normalizeAnswerMarkdownArtifacts(input);
    const lines = output.split("\n");

    // Chinese headings → markdown headings
    expect(lines[0]).toBe("## 一、检索综述");
    // Blank line after heading
    expect(lines[1]).toBe("");
    // Body text is plain
    expect(lines[2]).toBe("本次检索到3份资料。");
    // Second heading
    expect(lines[3]).toBe("## 二、详细解析");
    // List numbering fixed
    expect(output).toContain("1. 第一点");
    expect(output).toContain("2. 第二点");
  });

  it("demotes heading-like first body line under 相关概念 to plain text", () => {
    const input = [
      "## 相关概念",
      "## 贴线率是城市设计中管控街道界面连续性的核心指标",
      "## 详细解析",
    ].join("\n");

    const output = normalizeAnswerMarkdownArtifacts(input);

    expect(output).toContain("## 相关概念");
    expect(output).not.toContain("## 贴线率是城市设计中管控街道界面连续性的核心指标");
    expect(output).toContain("贴线率是城市设计中管控街道界面连续性的核心指标");
    expect(output).toContain("## 详细解析");
  });

  it("handles bold/zero-width wrapped related concepts headings and keeps next major section", () => {
    const input = [
      "## **相关概念**",
      "##\u200B**贴线率是城市设计中管控街道界面连续性的核心指标**",
      "## 详细解析",
    ].join("\n");

    const output = normalizeAnswerMarkdownArtifacts(input);

    expect(output).toContain("## **相关概念**");
    expect(output).not.toContain("## **贴线率是城市设计中管控街道界面连续性的核心指标**");
    expect(output).toContain("贴线率是城市设计中管控街道界面连续性的核心指标");
    expect(output).toContain("## 详细解析");
  });

  it("demotes ALL headings under 相关概念, not just the first one", () => {
    const input = [
      "## 相关概念",
      "",
      "### 贴线率",
      "贴线率是衡量建筑立面沿街界面连续性的重要指标。",
      "### 建筑密度",
      "建筑密度反映地块的开发强度。",
      "",
      "## 详细解析",
    ].join("\n");

    const output = normalizeAnswerMarkdownArtifacts(input);

    expect(output).toContain("## 相关概念");
    expect(output).not.toContain("### 贴线率");
    expect(output).not.toContain("### 建筑密度");
    expect(output).toContain("贴线率");
    expect(output).toContain("建筑密度");
    expect(output).toContain("## 详细解析");
  });

  it("strips blockquote markers from body text inside 相关概念 section", () => {
    const input = [
      "## 相关概念",
      "> 贴线率是衡量建筑立面沿街界面连续性的重要指标。",
      "## 详细解析",
    ].join("\n");

    const output = normalizeAnswerMarkdownArtifacts(input);

    expect(output).toContain("贴线率是衡量建筑立面沿街界面连续性的重要指标。");
    expect(output).not.toMatch(/^>\s*贴线率/m);
  });

  it("replaces star-run placeholders like **** with readable fallback text", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("根据****（见参考资料[1-1]），城市环境性能评估分为五个阶段。")
    ).toBe("根据相关资料（见参考资料[1-1]），城市环境性能评估分为五个阶段。");
  });

  it("splits run-on numbered items into stable markdown ordered-list lines", () => {
    const input =
      "1.确定评估对象及阶段.2.评估准备.3.开展定量评估.4.作出评估结论.5.形成评估报告";

    const output = normalizeAnswerMarkdownArtifacts(input);

    expect(output).toContain("1. 确定评估对象及阶段.");
    expect(output).toContain("\n2. 评估准备.");
    expect(output).toContain("\n3. 开展定量评估.");
    expect(output).toContain("\n4. 作出评估结论.");
    expect(output).toContain("\n5. 形成评估报告");
  });

  it("normalizes loose pipe-separated table text into GFM-like multi-line table", () => {
    const input =
      "I类型|基础保障类层级|品质提升类层级|-----------|-----------|-----------|商业设施|便利店、超市、旅馆|综合购物中心";

    const output = normalizeAnswerMarkdownArtifacts(input);

    expect(output).toContain("| I类型 | 基础保障类层级 | 品质提升类层级 |");
    expect(output).toContain("| --- | --- | --- |");
    expect(output).toContain("| 商业设施 | 便利店、超市、旅馆 | 综合购物中心 |");
  });

  it("passes through malformed inline latex without aggressive sanitization (normalizeBrokenInlineMath is not in pipeline)", () => {
    const input = [
      "《城市交通规划理论及其应用》$\\text{建议值} \\geq \\text{3.6",
      "规范要求}",
      "：",
      "G",
      "B",
      "/",
      "T",
      "51328",
      "−",
      "2018",
      "：",
      "GB/T51328−2018\\text{规定中心城区路网密度} \\geq \\frac{\\text{8km}}{\\text{km² ---}}$### 四、优化策略",
      "###",
    ].join("\n");

    const output = normalizeAnswerMarkdownArtifacts(input);

    // normalizeBrokenInlineMath is not called in the pipeline, so the raw
    // LaTeX content passes through.  We only verify structural invariants.
    expect(output).toContain("四、优化策略");
    expect(output).not.toMatch(/^\s*###\s*$/m);
  });

  it("keeps valid inline latex stable instead of exposing raw commands", () => {
    expect(
      normalizeAnswerMarkdownArtifacts("基准值要求：$\\text{占比} \\geq \\text{54.0\\%(可浮动\\pm10\\%)}$。")
    ).toContain("$\\text{占比} \\geq \\text{54.0\\%(可浮动\\pm10\\%)}$");
  });

  it("demotes verbose sentence-like headings to body text while keeping numbered heading hierarchy", () => {
    const input = [
      "## 城市高度片区环境性能评估流程解析",
      "### 一、流程框架",
      "### 依据《高强度片区环境性能评估与优化指标标准》（1-1），评估流程分为5个阶段，遵循“底线约束-量化诊断-分级优化”逻辑。核心步骤包括：（见图1）",
      "### 图1：高强度片区环境性能评估流程",
      "### 二、分阶段实施要点",
    ].join("\n");

    const output = normalizeAnswerMarkdownArtifacts(input);

    expect(output).toContain("## 城市高度片区环境性能评估流程解析");
    expect(output).toContain("### 一、流程框架");
    expect(output).toContain("### 二、分阶段实施要点");
    expect(output).toContain("依据《高强度片区环境性能评估与优化指标标准");
    expect(output).toContain("见图1");
    expect(output).not.toContain(
      "### 依据《高强度片区环境性能评估与优化指标标准》（1-1），评估流程分为5个阶段"
    );
    expect(output).not.toMatch(/^###\s*图1[:：]/m);
  });

  it("removes orphan heading markers and normalizes heading spacing", () => {
    const input = [
      "###标题A",
      "###",
      "####    标题B",
    ].join("\n");

    const output = normalizeAnswerMarkdownArtifacts(input);

    expect(output).toContain("### 标题A");
    expect(output).toContain("#### 标题B");
    expect(output).not.toMatch(/^\s*###\s*$/m);
  });
});
