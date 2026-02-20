import { describe, expect, it } from "vitest";

import { getSourcePreviewCacheKey } from "./source-preview-cache";

describe("getSourcePreviewCacheKey", () => {
  it("builds a stable key from chunk_ids regardless of order", () => {
    const a = getSourcePreviewCacheKey({ chunk_ids: ["c3", "c1", "c2"] });
    const b = getSourcePreviewCacheKey({ chunk_ids: ["c1", "c2", "c3"] });
    expect(a).toBe("c1|c2|c3");
    expect(a).toBe(b);
  });

  it("falls back to chunk_id when chunk_ids is absent", () => {
    expect(getSourcePreviewCacheKey({ chunk_id: "single-1" })).toBe("single-1");
  });

  it("returns null when no chunk identity exists", () => {
    expect(getSourcePreviewCacheKey({})).toBeNull();
  });
});

