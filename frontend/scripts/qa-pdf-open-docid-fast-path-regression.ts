import assert from "node:assert/strict";
import type { SourceInfo } from "../features/qa/types";
import { resolvePdfUrlForSource } from "../lib/resolve-pdf-url";

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;

  try {
    const source: SourceInfo = {
      type: "document",
      source: "vector_search",
      name: "深圳湾科技生态园空间控制图.pdf",
      citation_label: "1-4",
      chunk_id: "chunk-1",
      doc_id: "doc-1",
    };

    const url = await resolvePdfUrlForSource(source);

    assert.equal(url, "/api/rag/documents/doc-1/pdf");
    assert.deepEqual(fetchCalls, [], "expected doc_id-backed PDF open to avoid source-detail fetch");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().then(() => {
  console.log("qa-pdf-open-docid-fast-path-regression passed");
});
