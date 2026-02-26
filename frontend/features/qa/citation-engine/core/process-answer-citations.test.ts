import { describe, expect, it } from "vitest";
import { processAnswerCitations } from "@/features/qa/citation-engine";
import type { SourceInfo } from "@/features/qa/types";

function createSources(labels: string[]): SourceInfo[] {
  return labels.map((label, idx) => ({
    type: "document",
    name: `Doc ${idx + 1}`,
    citation_label: label,
    source: "document_search",
  }));
}

describe("citation-engine/processAnswerCitations", () => {
  it("converts valid citation labels into source anchors in final mode", () => {
    const out = processAnswerCitations({
      text: "结论见[1-1]。补充见[1-2]。",
      sources: createSources(["1-1", "1-2"]),
      isStreaming: false,
    });

    expect(out).toContain("[1-1](#source-1-1)");
    expect(out).toContain("[1-2](#source-1-2)");
  });

  it("keeps streaming mode lightweight and removes inline bare labels", () => {
    const out = processAnswerCitations({
      text: "流式片段[1-1]",
      sources: createSources(["1-1"]),
      isStreaming: true,
    });

    expect(out).toBe("流式片段");
  });

  it("converts body circled numerals into citation anchors in final mode", () => {
    const out = processAnswerCitations({
      text: "详细解析：该结论由资料共同支撑①。",
      sources: createSources(["1-1"]),
      isStreaming: false,
    });

    expect(out).toContain("[1-1](#source-1-1)");
  });

  it("does not rewrite circled numerals inside retrieval overview blockquote", () => {
    const out = processAnswerCitations({
      text: "> 检索资料清单：①附件1\n\n详细解析：结论如下①。",
      sources: createSources(["1-1"]),
      isStreaming: false,
    });

    expect(out).toContain("> 检索资料清单：①附件1");
    expect(out).toContain("[1-1](#source-1-1)");
  });
});
