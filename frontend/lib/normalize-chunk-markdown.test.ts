import { describe, expect, it } from "vitest";

import { normalizeChunkMarkdown } from "./normalize-chunk-markdown";

describe("normalizeChunkMarkdown", () => {
  it("maps `4.` headings to ##", () => {
    const input = "4.指标体系\n正文";
    const out = normalizeChunkMarkdown(input);
    expect(out).toContain("## 4. 指标体系");
  });

  it("maps `4.1` headings to ### (and unwraps full-line bold)", () => {
    const input = "**4.1评估要求**\n内容";
    const out = normalizeChunkMarkdown(input);
    expect(out).toContain("### 4.1 评估要求");
    expect(out).toContain("\n内容");
  });

  it("maps `4.1.1` headings to ####", () => {
    const input = "4.1.1城市高强度片区环境性能评估\n内容";
    const out = normalizeChunkMarkdown(input);
    expect(out).toContain("#### 4.1.1 城市高强度片区环境性能评估");
  });

  it("splits run-on headings before numbering", () => {
    const input = "4.2指标体系 4.2.1城市高强度片区环境性能评估指标体系由安全性能...";
    const out = normalizeChunkMarkdown(input);
    // both headings should become their own lines
    expect(out).toMatch(/### 4\.2 指标体系\n#### 4\.2\.1 城市高强度片区环境性能评估指标体系由安全性能/);
  });

  it("unwraps whole-block bold before splitting run-on headings", () => {
    const input = "**4.2指标体系 4.2.1城市高强度片区环境性能评估指标体系由安全性能...**";
    const out = normalizeChunkMarkdown(input);
    expect(out).not.toContain("**");
    expect(out).toMatch(/### 4\.2 指标体系\n#### 4\.2\.1 城市高强度片区环境性能评估指标体系由安全性能/);
  });

  it("maps PPT-style slide titles like `05地块信息一览表 (...)` to a top heading and keeps body text", () => {
    const input = "05地块信息一览表（GHJ街坊） 根据已出让用地的相关文件，结合城市设计要求...";
    const out = normalizeChunkMarkdown(input);
    expect(out).toContain("## 05 地块信息一览表（GHJ街坊）");
    expect(out).toContain("\n根据已出让用地的相关文件");
  });
});
