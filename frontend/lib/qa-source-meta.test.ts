import { describe, expect, it } from "vitest";

import type { SourceInfo } from "@/features/qa/types";
import { deriveSourceMeta } from "./qa-source-meta";

describe("deriveSourceMeta", () => {
  it("prefers source meta when present", () => {
    const source: SourceInfo = {
      type: "document",
      name: "any.pdf",
      source: "vector_search",
      section: "4.1评估要求",
      page: 10,
      page_end: 12,
    };

    const meta = deriveSourceMeta(source, null);
    expect(meta.title).toBe("4.1评估要求");
    expect(meta.pageLabel).toBe("第 10-12 页");
  });

  it("falls back to preview meta when source meta is missing", () => {
    const source: SourceInfo = {
      type: "document",
      name: "any.pdf",
      source: "vector_search",
    };

    const meta = deriveSourceMeta(source, {
      section_title: "4.2指标体系",
      page_hint: 8,
      page_end_hint: 8,
      has_image: true,
    });

    expect(meta.title).toBe("4.2指标体系");
    expect(meta.pageLabel).toBe("第 8 页");
    expect(meta.hasImage).toBe(true);
  });
});

