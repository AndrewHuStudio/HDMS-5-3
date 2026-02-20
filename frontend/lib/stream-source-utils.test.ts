import { describe, expect, it } from "vitest";

import {
  collapseFigureMentions,
  mergeThinkingIntoAnswer,
  mergeStreamingSources,
} from "./stream-source-utils";
import type { SourceInfo } from "@/features/qa/types";

describe("mergeStreamingSources", () => {
  it("keeps image-bearing sources when replaced payload drops them", () => {
    const previous: SourceInfo[] = [
      {
        type: "document",
        name: "A.pdf",
        source: "vector_search",
        citation_label: "1-1",
        chunk_id: "chunk-img",
        image_urls: ["/rag/documents/d1/image?ref=img1.png"],
        image_names: ["img1.png"],
      },
      {
        type: "document",
        name: "B.pdf",
        source: "vector_search",
        citation_label: "2-1",
        chunk_id: "chunk-b",
      },
    ];

    const incoming: SourceInfo[] = [
      {
        type: "document",
        name: "B.pdf",
        source: "vector_search",
        citation_label: "2-1",
        chunk_id: "chunk-b",
      },
    ];

    const merged = mergeStreamingSources(previous, incoming);

    expect(merged.map((s) => s.chunk_id)).toContain("chunk-img");
    const imageSource = merged.find((s) => s.chunk_id === "chunk-img");
    expect(imageSource?.image_urls?.length).toBe(1);
  });

  it("prefers latest source fields while preserving previous image metadata", () => {
    const previous: SourceInfo[] = [
      {
        type: "document",
        name: "A.pdf",
        source: "vector_search",
        citation_label: "1-1",
        chunk_id: "chunk-1",
        image_urls: ["/rag/documents/d1/image?ref=img1.png"],
        image_names: ["img1.png"],
      },
    ];

    const incoming: SourceInfo[] = [
      {
        type: "document",
        name: "A-new.pdf",
        source: "vector_search",
        citation_label: "1-1",
        chunk_id: "chunk-1",
      },
    ];

    const merged = mergeStreamingSources(previous, incoming);

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("A-new.pdf");
    expect(merged[0].image_urls).toEqual(["/rag/documents/d1/image?ref=img1.png"]);
  });
});

describe("mergeThinkingIntoAnswer", () => {
  it("injects a thinking section into final answer", () => {
    const merged = mergeThinkingIntoAnswer({
      answer: "## 详细解析\n\n正文",
      thinking: "先检索，再比对，再结论",
      isStreaming: false,
    });

    expect(merged).toContain("## 思考过程");
    expect(merged).toContain("先检索，再比对，再结论");
    expect(merged).toContain("## 详细解析");
  });

  it("does not duplicate section if answer already includes thinking heading", () => {
    const answer = "## 思考过程\n\n已有内容\n\n## 详细解析\n\n正文";
    const merged = mergeThinkingIntoAnswer({
      answer,
      thinking: "额外思考",
      isStreaming: false,
    });

    expect(merged).toBe(answer);
  });
});

describe("collapseFigureMentions", () => {
  it("deduplicates repeated figure mentions globally while preserving first occurrence", () => {
    const output = collapseFigureMentions(
      "流程（见图1）（见图1），结果（见图2）。\n补充仍写（见图1）。"
    );

    expect(output).toContain("流程（图1），结果（图2）。");
    expect(output).not.toContain("补充仍写（图1）。");
    expect(output).not.toContain("（图1）（图1）");
  });
});
