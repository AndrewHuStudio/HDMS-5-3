# Structured Image-Grounded QA Design

## Goal

Return answer text and relevant images as one validated document structure. Each answer section may carry zero or more images from the evidence cited by that section. New answers must not generate or parse `[[IMG:...]]` anchors.

## Current failure

The existing pipeline flattens image metadata into source arrays, teaches the model to write `[[IMG:N-M#K]]`, then uses a large frontend regex/heuristic module to locate, replace, move, deduplicate, and append images. It also has an upstream recall gap: Mongo text search can return an empty result without raising, so the image fallback never runs. The result is brittle in two independent ways: relevant images may never enter the source list, and returned images depend on free-form anchor placement.

## Architecture

### Evidence records

`context_builder.py` continues resolving document image references, but additionally creates nested image evidence records:

```json
{
  "id": "img-<stable digest>",
  "url": "/rag/documents/<doc>/image?ref=<ref>",
  "caption": "建筑退线控制示意图",
  "figure": "图3.0.1",
  "hint": "图3.0.1 建筑退线控制示意图",
  "source_label": "2-1",
  "doc_id": "<doc>",
  "page": 18
}
```

The ID is derived from immutable document/image identity, not the transient citation label. The source keeps its existing image arrays for the source sidebar, while the new `images` field becomes the answer-binding contract.

### Recall

Image-bearing evidence is recalled independently of whether ordinary top-k results happen to include an image. A successful-but-empty Mongo text query must continue to the bounded keyword fallback, and results are merged/deduplicated before context construction. This fallback improves recall only; it never chooses image position.

### Answer document

The model produces normal Markdown with the existing canonical `[N-M]` evidence citations. It no longer knows about image anchors or filenames. After citation normalization, the backend divides the finalized Markdown into ordered top-level blocks with a small Markdown-aware scanner. Each block becomes an answer section. Canonical citation labels in the section select source records, and the server attaches their nested image evidence. Only images present in the current retrieval result can be attached; duplicate image IDs are emitted once.

```json
{
  "sections": [
    {
      "id": "section-1",
      "markdown": "建筑退线应从用地红线计算……[2-1]",
      "source_labels": ["2-1"],
      "images": [{"id": "img-…", "url": "…", "caption": "…"}]
    }
  ]
}
```

This uses citations as exact foreign keys, not a semantic regex that guesses where an image belongs. Sections without supporting citations receive no images. When a cited source contains multiple images, all validated images are returned in source order.

### Streaming and rendering

Raw answer tokens continue streaming for low perceived latency. At finalization the backend emits one `answer_document` event containing normalized sections and bound images. The frontend deterministically compiles the document into Markdown in section order and replaces the provisional token stream before `done`. The existing Markdown renderer therefore remains unchanged, while image placement no longer depends on source-image injection heuristics.

The new event supersedes `answer_replaced` for server-finalized content. Non-streaming fallback accepts the same document shape when available and otherwise uses plain text.

## Removal scope

- Remove IMG catalogue text from the model context.
- Remove IMG instructions from the system prompt.
- Remove IMG normalization/remapping from backend answer post-processing.
- Delete the frontend image-injection pipeline and the oversized `inject-source-images.ts` module.
- Replace anchor-specific regression scripts with structured-document regressions.
- Do not retain historical anchor compatibility; historical conversations may be discarded.

## Validation and failure behavior

- Drop images without an ID or URL.
- Reject image objects not owned by a source referenced in the current answer section.
- Deduplicate by stable image ID while preserving retrieval order.
- A missing/broken image never blocks the textual answer.
- A section without a cited image-bearing source renders text only.
- The server never emits raw filesystem paths or original opaque filenames as captions.
- Existing source citations, PDF links, tables, graphs, and quick replies remain supported.

## Testing strategy

Backend tests prove stable image evidence construction, empty text-search fallback, one-to-many section binding, invalid/unreferenced image rejection, deduplication, and `answer_document` event order. Frontend tests prove SSE dispatch and deterministic section/image rendering without `[[IMG:...]]`. Final verification includes focused suites, type/lint/build checks where available, an anchor-free repository search over active source, and the mandatory 600-line module check.
