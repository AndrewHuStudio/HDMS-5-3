import { describe, expect, it } from "vitest";

import type { SourceInfo } from "../features/qa/types";
import { normalizeCitationSources } from "./normalize-citation-sources";

describe("normalizeCitationSources", () => {
  it("merges duplicate citation_label entries into one", () => {
    const sources: SourceInfo[] = [
      {
        type: "doc",
        name: "Doc A",
        source: "vector",
        citation_label: "2-2",
        page: 29,
        chunk_id: "c1",
        image_urls: ["u1"],
      },
      {
        type: "doc",
        name: "Doc A (dup)",
        source: "vector",
        citation_label: "2-2",
        page: 28,
        chunk_id: "c2",
        image_urls: ["u2"],
      },
    ];

    const out = normalizeCitationSources(sources);
    expect(out).toHaveLength(1);
    expect(out[0].citation_label).toBe("2-2");
    expect(out[0].page).toBe(28);
    expect(out[0].page_end).toBe(29);
    expect(out[0].chunk_ids?.sort()).toEqual(["c1", "c2"]);
    expect(out[0].image_urls?.sort()).toEqual(["u1", "u2"]);
  });

  it("keeps sources without citation_label as separate entries", () => {
    const sources: SourceInfo[] = [
      { type: "doc", name: "X", source: "vector" },
      { type: "doc", name: "Y", source: "vector" },
    ];
    expect(normalizeCitationSources(sources)).toHaveLength(2);
  });
});
