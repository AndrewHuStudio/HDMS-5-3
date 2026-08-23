import assert from "node:assert/strict";
import type { SourceInfo } from "../features/qa/types";
import { normalizeCitationSources } from "../lib/normalize-citation-sources";

function buildSource(overrides: Partial<SourceInfo>): SourceInfo {
  return {
    type: "document",
    source: "vector_search",
    name: "附件1-1城市高强度片区界定与分类标准（征求意见稿）.pdf",
    doc_id: "doc-1",
    ...overrides,
  };
}

function main(): void {
  // Regression: the backend could emit two sources sharing a citation_label
  // (partial remap collision). Merging them dropped a real citation and
  // collapsed its page number via min(), so "查看PDF" opened the wrong page.
  const duplicateLabelDistinctChunks = [
    buildSource({ citation_label: "1-1", chunk_id: "chunk-a", page: undefined }),
    buildSource({ citation_label: "1-1", chunk_id: "chunk-b", page: 6 }),
    buildSource({ citation_label: "1-2", chunk_id: "chunk-c" }),
  ];

  const normalized = normalizeCitationSources(duplicateLabelDistinctChunks);

  assert.equal(normalized.length, 3, "expected distinct chunks to keep their own cards");

  const labels = normalized.map((s) => s.citation_label);
  assert.equal(
    new Set(labels).size,
    labels.length,
    `expected unique citation labels, got ${JSON.stringify(labels)}`,
  );

  const chunkB = normalized.find((s) => s.chunk_id === "chunk-b");
  assert.ok(chunkB, "expected chunk-b to survive normalization");
  assert.equal(chunkB.page, 6, "expected chunk-b to keep its own page number");

  const chunkA = normalized.find((s) => s.chunk_id === "chunk-a");
  assert.ok(chunkA, "expected chunk-a to survive normalization");
  assert.equal(chunkA.page, undefined, "expected chunk-a page not to absorb chunk-b's page");

  // Genuine duplicates of the same chunk should still collapse into one card.
  const sameChunkTwice = [
    buildSource({ citation_label: "2-1", chunk_id: "chunk-x", page: 4 }),
    buildSource({ citation_label: "2-1", chunk_id: "chunk-x", page: 9 }),
  ];

  const merged = normalizeCitationSources(sameChunkTwice);
  assert.equal(merged.length, 1, "expected same-chunk duplicates to merge");
  assert.equal(merged[0].page, 4, "expected merged card to keep the lowest page");
  assert.equal(merged[0].page_end, 9, "expected merged card to widen the page range");
}

main();
console.log("qa-duplicate-citation-label-keeps-distinct-sources-regression passed");
