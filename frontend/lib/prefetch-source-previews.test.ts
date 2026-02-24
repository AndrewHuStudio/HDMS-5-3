import { describe, expect, it, vi } from "vitest";

import { prefetchSourcePreviews } from "./prefetch-source-previews";

describe("prefetchSourcePreviews", () => {
  it("prefetches first chunk for each source up to limit and calls onPreview", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ chunk_id: "c1" }),
    })) as unknown as typeof fetch;

    const onPreview = vi.fn();
    await prefetchSourcePreviews({
      sources: [
        { chunk_ids: ["b", "a"] },
        { chunk_id: "c2" },
        { chunk_id: "c3" },
      ],
      query: "hello",
      limit: 2,
      qaApiBase: "http://example.test",
      fetchFn: fetchMock,
      onPreview,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onPreview).toHaveBeenCalledTimes(2);
    // For chunk_ids the cache key is a stable sorted join.
    expect(onPreview).toHaveBeenCalledWith("a|b", expect.anything());
  });

  it("skips sources without chunk identity", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const onPreview = vi.fn();
    await prefetchSourcePreviews({
      sources: [{}, { chunk_ids: [] }],
      query: "x",
      limit: 10,
      qaApiBase: "http://example.test",
      fetchFn: fetchMock,
      onPreview,
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(onPreview).toHaveBeenCalledTimes(0);
  });
});
