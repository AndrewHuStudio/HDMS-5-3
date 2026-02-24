import { describe, expect, it, vi } from "vitest";

import type { SourceInfo } from "@/features/qa/types";
import { resolvePdfUrlForSource } from "./resolve-pdf-url";

describe("resolvePdfUrlForSource", () => {
  it("builds /api pdf url with hash page when doc_id + page exist", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      // Should not be called in this case; keep a default mock to avoid accidental network calls.
      .mockResolvedValue(new Response(null, { status: 500 }));

    const source: SourceInfo = {
      type: "document",
      name: "any.pdf",
      source: "vector_search",
      doc_id: "doc-123",
      page: 17,
    };

    const url = await resolvePdfUrlForSource(source);
    expect(url).toBe("/api/rag/documents/doc-123/pdf#page=17");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches page_hint when source.page is missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          chunk_id: "c1",
          doc_id: "doc-123",
          page_hint: 29,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const source: SourceInfo = {
      type: "document",
      name: "any.pdf",
      source: "vector_search",
      doc_id: "doc-123",
      chunk_id: "c1",
    };

    const url = await resolvePdfUrlForSource(source);
    expect(url).toBe("/api/rag/documents/doc-123/pdf#page=29");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("can fall back to doc_id from the details endpoint when missing on source", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          chunk_id: "c1",
          doc_id: "doc-xyz",
          page_hint: 5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const source: SourceInfo = {
      type: "document",
      name: "any.pdf",
      source: "vector_search",
      chunk_id: "c1",
    };

    const url = await resolvePdfUrlForSource(source);
    expect(url).toBe("/api/rag/documents/doc-xyz/pdf#page=5");
  });
});

