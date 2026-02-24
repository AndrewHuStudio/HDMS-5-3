import { describe, expect, it } from "vitest";

import { normalizeChunkImages } from "./normalize-chunk-images";

describe("normalizeChunkImages", () => {
  it("rewrites relative markdown image refs to /rag/documents/{docId}/image", () => {
    const input = "text ![alt](images/foo.png) end";
    const out = normalizeChunkImages(input, { docId: "doc-1" });
    expect(out).toContain("![alt](/rag/documents/doc-1/image?ref=images%2Ffoo.png)");
  });

  it("strips markdown image titles before rewriting", () => {
    const input = '![alt](images/foo.png "title")';
    const out = normalizeChunkImages(input, { docId: "doc-1" });
    expect(out).toContain("ref=images%2Ffoo.png");
    expect(out).not.toContain("title");
  });

  it("does not rewrite http(s) markdown image refs", () => {
    const input = "![alt](https://example.com/a.png)";
    const out = normalizeChunkImages(input, { docId: "doc-1" });
    expect(out).toBe(input);
  });

  it("rewrites raw HTML img src to /rag/documents/{docId}/image", () => {
    const input = '<img src="images/foo.png" alt="x" />';
    const out = normalizeChunkImages(input, { docId: "doc-1" });
    expect(out).toContain('src="/rag/documents/doc-1/image?ref=images%2Ffoo.png"');
  });
});

