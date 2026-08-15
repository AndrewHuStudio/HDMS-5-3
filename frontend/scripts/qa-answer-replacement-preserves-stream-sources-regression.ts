function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

import { mergeStreamingSources } from "../lib/stream-source-utils";
import type { SourceInfo } from "../features/qa/types";

const streamedSources: SourceInfo[] = [
  {
    type: "document",
    name: "GB51039-2014综合医院建筑设计标准.pdf",
    source: "vector_search",
    citation_label: "1-1",
    chunk_id: "chunk-a",
    doc_id: "doc-a",
  },
  {
    type: "document",
    name: "综合医院医疗功能规模循证设计_崔怡卓.pdf",
    source: "knowledge_graph",
    citation_label: "2-1",
    chunk_id: "chunk-b",
    doc_id: "doc-b",
  },
  {
    type: "document",
    name: "医院建筑设计指南.pdf",
    source: "vector_search",
    citation_label: "3-1",
    chunk_id: "chunk-c",
    doc_id: "doc-c",
    image_urls: ["/rag/documents/doc-c/image?ref=images/layout.png"],
    image_names: ["layout.png"],
  },
];

const finalReplacementSources: SourceInfo[] = [
  {
    type: "document",
    name: "GB51039-2014综合医院建筑设计标准.pdf",
    source: "vector_search",
    citation_label: "1-1",
    chunk_id: "chunk-a",
    doc_id: "doc-a",
  },
];

const merged = mergeStreamingSources(streamedSources, finalReplacementSources);

assert(merged.length === 3, `expected all streamed sources to survive final replacement, got ${merged.length}`);
assert(merged.some((s) => s.doc_id === "doc-a"), "expected cited final source to remain");
assert(merged.some((s) => s.doc_id === "doc-b"), "expected uncited graph-related source to remain");
assert(merged.some((s) => s.doc_id === "doc-c"), "expected image-bearing source to remain");
assert(
  merged.some((s) => s.doc_id === "doc-c" && s.image_urls?.includes("/rag/documents/doc-c/image?ref=images/layout.png")),
  "expected image metadata to survive source replacement",
);

console.log("qa-answer-replacement-preserves-stream-sources-regression passed");

export {};
