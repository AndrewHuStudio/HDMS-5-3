import { describe, expect, it } from "vitest";

import type { SourceInfo } from "@/features/qa/types";
import { injectSourceImages } from "./inject-source-images";

describe("injectSourceImages", () => {
  it("injects image inline next to citation when source has images, even if answer has no '如下图/见图' wording", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: ["/rag/documents/doc-1/image?ref=cover.png"],
        image_names: ["cover.png"],
        image_captions: ["图4.6 公共服务设施立体覆盖率示意图"],
      },
    ];

    const input = "公共服务设施的立体覆盖率是指……[1-1](#source-1-1)";
    const out = injectSourceImages(input, sources, "公共服务设施的立体覆盖率是什么？");

    // Image should be injected inline near the citation, not in a separate appendix
    expect(out).toContain("![公共服务设施立体覆盖率示意图](/rag/documents/doc-1/image?ref=cover.png)");
    expect(out).toContain("（图1）");
  });

  it("injects the matching figure image when a paragraph references 图号", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: ["/rag/documents/doc-1/image?ref=a.png", "/rag/documents/doc-1/image?ref=b.png"],
        image_names: ["a.png", "b.png"],
        image_figures: ["图3.0.1", "图3.0.2"],
        image_captions: ["图3.0.1 评估流程图", "图3.0.2 指标体系图"],
      },
    ];

    const input = "流程图如图3.0.1所示。[1-1](#source-1-1)\n\n下一段";
    const out = injectSourceImages(input, sources);

    expect(out).toContain("（图1）[1-1](#source-1-1)");
    expect(out).toContain("![评估流程图](/rag/documents/doc-1/image?ref=a.png)");
    expect(out).toContain("图1：评估流程图");
    expect(out).not.toContain("ref=b.png");
  });

  it("injects image from cited source even when there is no figure reference and no explicit '下图/如图'", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: ["/rag/documents/doc-1/image?ref=a.png"],
        image_names: ["a.png"],
      },
    ];

    const input = "这是一段普通文字。[1-1](#source-1-1)";
    const out = injectSourceImages(input, sources);
    // Now we inject images from cited sources even without explicit figure mentions
    expect(out).toContain("![a.png](/rag/documents/doc-1/image?ref=a.png)");
    expect(out).toContain("（图1）");
  });

  it("falls back to the first image when the paragraph says '如下图' but no figure number is present", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: ["/rag/documents/doc-1/image?ref=a.png"],
        image_names: ["a.png"],
        image_captions: ["流程图"],
      },
    ];

    const input = "如下图所示，这是一个流程图。[1-1](#source-1-1)";
    const out = injectSourceImages(input, sources);
    expect(out).toContain("（图1）[1-1](#source-1-1)");
    expect(out).toContain("![流程图](/rag/documents/doc-1/image?ref=a.png)");
    expect(out).toContain("图1：流程图");
  });

  it("injects by matching caption when the answer contains a '此处应插入' placeholder (even without citations)", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: ["/rag/documents/doc-1/image?ref=section.png"],
        image_names: ["section.png"],
        image_captions: ["地下空间剖面示意图"],
      },
    ];

    const input = [
      "这里讨论地下空间组织。",
      "[地下空间剖面示意图]（注：此处应插入文档中相关配图，但当前资料未见附图。）",
      "下一段。",
    ].join("\n");

    const out = injectSourceImages(input, sources);
    expect(out).toContain("![地下空间剖面示意图](/rag/documents/doc-1/image?ref=section.png)");
    expect(out).toContain("这里讨论地下空间组织（图1）。");
    expect(out).toContain("图1：地下空间剖面示意图");
    expect(out).not.toContain("此处应插入");
    expect(out).not.toContain("未见附图");
  });

  it("uses a cleaned caption from a numbered sentence like '3.1.2 XXX应按照下图3.1.2的步骤' for the figure caption", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: ["/rag/documents/doc-1/image?ref=flow.png"],
        image_names: ["flow.png"],
        image_captions: ["3.1.2 城市高强度片区的界定与分类流程应按照下图3.1.2的步骤"],
      },
    ];

    const input =
      "3.1.2 城市高强度片区的界定与分类流程应按照下图3.1.2的步骤。[1-1](#source-1-1)";
    const out = injectSourceImages(input, sources);

    expect(out).toContain("图1：城市高强度片区的界定与分类流程");
  });

  it("falls back to '相关示意图' when no caption/name can be inferred", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: ["/rag/documents/doc-1/image?ref=81cadf.png"],
        image_names: ["81cadf3fca866302455fb7fb3f4671afea2a451ce118c186.png"],
      },
    ];

    const input = "这段文字提到有配图。[1-1](#source-1-1)";
    const out = injectSourceImages(input, sources);

    expect(out).toContain("图1：相关示意图");
  });

  it("injects the first image when the paragraph mentions '控制图/示意图' and has a citation, even without '下图' wording", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: ["/rag/documents/doc-1/image?ref=map.png"],
        image_names: ["map.png"],
        image_captions: ["GHJK街坊空间控制总图"],
      },
    ];

    const input = "控制图展示了街坊空间控制要点。[1-1](#source-1-1)";
    const out = injectSourceImages(input, sources);
    expect(out).toContain("（图1）[1-1](#source-1-1)");
    expect(out).toContain("![GHJK街坊空间控制总图](/rag/documents/doc-1/image?ref=map.png)");
    expect(out).toContain("图1：GHJK街坊空间控制总图");
  });

  it("injects when the answer contains an explicit '（见图N）' placeholder even without figure tokens or image keywords", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: ["/rag/documents/doc-1/image?ref=a.png"],
        image_names: ["a.png"],
        image_captions: ["流程框架示意图"],
      },
    ];

    // Include an existing image so the "append related figures" fallback won't mask failures.
    const input = [
      "![已有图片](/already.png)",
      "",
      "这里需要插入一张图（见图1）。[1-1](#source-1-1)",
    ].join("\n");
    const out = injectSourceImages(input, sources);

    expect(out).toContain("![流程框架示意图](/rag/documents/doc-1/image?ref=a.png)");
    expect(out).toContain("图1：流程框架示意图");
  });

  it("indents injected image blocks under ordered list items so list numbering is preserved", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: ["/rag/documents/doc-1/image?ref=flow.png"],
        image_names: ["flow.png"],
        image_figures: ["图3.0.1"],
        image_captions: ["图3.0.1 评估流程图"],
      },
    ];

    const input = [
      "1. 流程图如图3.0.1所示。[1-1](#source-1-1)",
      "2. 第二点仍应保持编号连续。",
    ].join("\n");
    const out = injectSourceImages(input, sources);

    // For a "1. " list marker, the list item content indent is 3 spaces.
    expect(out).toContain("\n   ![评估流程图](/rag/documents/doc-1/image?ref=flow.png)");
    expect(out).toContain("\n   图1：评估流程图");
  });

  it("injects distinct images for sequential '（见图N）' placeholders so later figures don't get skipped", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: [
          "/rag/documents/doc-1/image?ref=a.png",
          "/rag/documents/doc-1/image?ref=b.png",
        ],
        image_names: ["a.png", "b.png"],
        image_captions: ["第一张图", "第二张图"],
      },
    ];

    const input = [
      "1. 第一处需要插图（见图1）。[1-1](#source-1-1)",
      "2. 第二处也需要插图（见图2）。[1-1](#source-1-1)",
    ].join("\n");
    const out = injectSourceImages(input, sources);

    expect(out).toContain("/rag/documents/doc-1/image?ref=a.png");
    expect(out).toContain("/rag/documents/doc-1/image?ref=b.png");
    expect(out).toContain("图1：第一张图");
    expect(out).toContain("图2：第二张图");
  });

  it("normalizes existing refs like '（见图3.0.1）' to clean '（图N）' without leaking suffix fragments", () => {
    const sources: SourceInfo[] = [
      {
        type: "document",
        name: "a.pdf",
        source: "vector_search",
        citation_label: "1-1",
        image_urls: ["/rag/documents/doc-1/image?ref=a.png"],
        image_names: ["a.png"],
        image_figures: ["图3.0.1"],
        image_captions: ["图3.0.1 评估流程图"],
      },
    ];

    const input = "评估流程按五个阶段推进执行（见图3.0.1）。[1-1](#source-1-1)";
    const out = injectSourceImages(input, sources);

    expect(out).toContain("执行（图1）。[1-1](#source-1-1)");
    expect(out).not.toContain("（图1）.0.1");
    expect(out).not.toContain("图2）.0.3");
  });
});
