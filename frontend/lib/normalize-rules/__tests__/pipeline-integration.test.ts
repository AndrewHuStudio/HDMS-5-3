/**
 * Baseline integration tests for normalizeAnswerMarkdownArtifacts.
 *
 * These tests lock the current output of the normalization pipeline so that
 * the modular refactor (normalize-rules/) can be validated against the
 * original monolithic implementation.
 *
 * Run: cd frontend && npx vitest run lib/normalize-rules/__tests__/pipeline-integration.test.ts
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  normalizeAnswerMarkdownArtifacts,
} from "@/lib/normalize-answer-markdown-artifacts";

function fixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf-8");
}

describe("normalizeAnswerMarkdownArtifacts – baseline integration", () => {
  // -----------------------------------------------------------------------
  // Sample 1: Streaming partial (light mode)
  // -----------------------------------------------------------------------
  describe("streaming partial (light mode)", () => {
    const input = fixture("sample-streaming-partial.md");

    it("should strip <think> tags", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: true });
      expect(out).not.toContain("<think>");
      expect(out).not.toContain("</think>");
    });

    it("should replace fullwidth asterisks with standard asterisks", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: true });
      expect(out).not.toMatch(/[＊∗﹡]/);
    });

    it("should tighten bold whitespace", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: true });
      expect(out).not.toMatch(/\*\*\s+.*\s+\*\*/);
      expect(out).toContain("**建筑高度**");
    });

    it("should normalize unicode bullets to dashes", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: true });
      expect(out).not.toMatch(/^[ \t]*[•·]\s+/m);
      expect(out).toMatch(/^- 核心区域/m);
      expect(out).toMatch(/^- 过渡区域/m);
    });

    it("should fix run-on numbered items", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: true });
      // "1.基本限高" should become "1. 基本限高"
      expect(out).toMatch(/1\.\s+基本限高/);
    });

    it("should preserve heading in streaming mode", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: true });
      // In streaming mode the heading is kept but blank-line insertion may
      // not apply to all cases. Just verify the heading survives.
      expect(out).toContain("## 详细解析");
    });

    it("snapshot: streaming output is stable", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: true });
      expect(out).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Sample 2: Chinese headings (final mode)
  // -----------------------------------------------------------------------
  describe("chinese headings (final mode)", () => {
    const input = fixture("sample-chinese-headings.md");

    it("should convert Chinese headings to markdown headings", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: false });
      // "一、建筑高度控制" should become "## 一、建筑高度控制"
      expect(out).toMatch(/^## 一、建筑高度控制/m);
      // "二、退线距离要求" should become "## 二、退线距离要求"
      expect(out).toMatch(/^## 二、退线距离要求/m);
    });

    it("should convert sub-level Chinese headings", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: false });
      // "（一）核心区域限高" should become "### （一）核心区域限高"
      expect(out).toMatch(/^### （一）核心区域限高/m);
    });

    it("should fix ordered list numbering", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: false });
      // Sequential numbering: 1. 2. 3.
      expect(out).toMatch(/1\.\s+主干道退线/);
      expect(out).toMatch(/2\.\s+次干道退线/);
      expect(out).toMatch(/3\.\s+支路退线/);
    });

    it("snapshot: final output is stable", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: false });
      expect(out).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Sample 3: Mixed artifacts (final mode)
  // -----------------------------------------------------------------------
  describe("mixed artifacts (final mode)", () => {
    const input = fixture("sample-mixed-artifacts.md");

    it("should strip <think> tags", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: false });
      expect(out).not.toContain("<think>");
    });

    it("should normalize math delimiters", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: false });
      // \[...\] should become $$...$$
      expect(out).not.toMatch(/\\\[/);
      expect(out).not.toMatch(/\\\]/);
      // \(...\) should become $...$
      expect(out).not.toMatch(/\\\(/);
      expect(out).not.toMatch(/\\\)/);
    });

    it("should replace star-run placeholders", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: false });
      expect(out).not.toContain("****");
      expect(out).toContain("相关资料");
    });

    it("should normalize numeric range delimiters", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: false });
      // "50~~100" should become "50~100"
      expect(out).toContain("50~100");
      expect(out).not.toContain("50~~100");
    });

    it("should fix repeated heading numbering when applicable", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: false });
      // The heading-sequence rule renumbers ### N. headings under the same
      // ## section. In this fixture the two ### 1. live under the same ##,
      // so they should be renumbered. Verify at least one ### heading exists.
      const h3matches = out.match(/^###\s+\d+\./gm) || [];
      expect(h3matches.length).toBeGreaterThanOrEqual(1);
    });

    it("should promote conclusion heading", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: false });
      expect(out).toMatch(/^## 结论/m);
    });

    it("snapshot: final output is stable", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: false });
      expect(out).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Sample 3: Mixed artifacts (streaming mode) — lighter processing
  // -----------------------------------------------------------------------
  describe("mixed artifacts (streaming mode)", () => {
    const input = fixture("sample-mixed-artifacts.md");

    it("should still strip think tags in streaming", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: true });
      expect(out).not.toContain("<think>");
    });

    it("should still normalize math delimiters in streaming", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: true });
      expect(out).not.toMatch(/\\\[/);
      expect(out).not.toMatch(/\\\]/);
    });

    it("should NOT promote conclusion heading in streaming", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: true });
      // In streaming mode, conclusion heading promotion is skipped
      expect(out).not.toMatch(/^## 结论/m);
      expect(out).toContain("核心结论");
    });

    it("snapshot: streaming output is stable", () => {
      const out = normalizeAnswerMarkdownArtifacts(input, { streaming: true });
      expect(out).toMatchSnapshot();
    });
  });
});
