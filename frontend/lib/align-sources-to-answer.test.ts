import { describe, expect, it } from "vitest";

import type { SourceInfo } from "../features/qa/types";
import { alignSourcesToAnswer, collectReferencedCitationLabels, countReferencedCitations } from "./align-sources-to-answer";

describe("alignSourcesToAnswer", () => {
  it("filters sources down to only those referenced by citation markers", () => {
    const sources: SourceInfo[] = [
      { type: "doc", name: "A", source: "vector", citation_label: "1-1" },
      { type: "doc", name: "B", source: "vector", citation_label: "2-1" },
    ];
    const aligned = alignSourcesToAnswer("x[1-1] y", sources);
    expect(aligned.map((s) => s.citation_label)).toEqual(["1-1"]);
  });

  it("ignores invalid markers and returns all sources when none are referenced", () => {
    const sources: SourceInfo[] = [
      { type: "doc", name: "A", source: "vector", citation_label: "1-1" },
      { type: "doc", name: "B", source: "vector", citation_label: "2-1" },
    ];
    const aligned = alignSourcesToAnswer("x[9-9] y", sources);
    expect(aligned).toHaveLength(2);
  });

  it("dedupes duplicate citation_label sources first, then aligns", () => {
    const sources: SourceInfo[] = [
      { type: "doc", name: "A", source: "vector", citation_label: "2-2", page: 29, chunk_id: "c1" },
      { type: "doc", name: "A2", source: "vector", citation_label: "2-2", page: 28, chunk_id: "c2" },
      { type: "doc", name: "B", source: "vector", citation_label: "1-1" },
    ];
    const aligned = alignSourcesToAnswer("ref[2-2] only", sources);
    expect(aligned).toHaveLength(1);
    expect(aligned[0].citation_label).toBe("2-2");
    expect(aligned[0].page).toBe(28);
    expect(aligned[0].page_end).toBe(29);
  });
});

describe("collectReferencedCitationLabels", () => {
  it("collects valid labels even if answer contains many repeats", () => {
    const sources: SourceInfo[] = [
      { type: "doc", name: "A", source: "vector", citation_label: "1-1" },
      { type: "doc", name: "B", source: "vector", citation_label: "2-1" },
    ];
    const labels = collectReferencedCitationLabels("a[1-1] b[1-1] c[2-1]", sources);
    expect(Array.from(labels).sort()).toEqual(["1-1", "2-1"]);
    expect(countReferencedCitations("a[1-1] b[1-1] c[2-1]", sources)).toBe(2);
  });
});

