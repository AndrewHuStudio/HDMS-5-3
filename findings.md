# Findings: QA streaming diagnosis

## Requirements
- During a QA request, the complete user-visible thinking stream must finish before the retrieval overview becomes visible.
- The retrieval overview remains in its current relative location: directly before the formal answer, not as a post-answer summary.
- Formal answer text and related materials/images continue in their existing streaming order, but arrive faster.

## Initial Evidence
- `backend/qa_assistant/rag/service.py` currently emits the retrieval overview as an `answer` event before it invokes the LLM stream, so it necessarily appears before any `thinking` event.
- Existing test `test_stream_latency_behaviour.py` encodes this current order.
- The route serializes every yielded event as an SSE frame and sets `X-Accel-Buffering: no`; the production Nginx location also has `proxy_buffering off`. Reverse-proxy response buffering is therefore not supported as the cause by the checked configuration.
- The frontend receives and buffers answer tokens until the next browser animation frame (normally <=16.7ms), with a per-frame limit of 96 characters. This is intentional visual pacing but cannot explain multi-second waits unless a very large single server chunk is received.
- The frontend deliberately hides `answer` content while `thinking` exists and `thinkingDone` is false. This safeguard is correct for the requested UX, but the backend currently violates it by emitting the overview before thought tokens: before a thought token arrives, the frontend has no reason to hide it.
- `sources`, `retrieval_stats`, and graph data are emitted before reasoning too. The source panel itself is deferred until completion, but the retrieval-stat state is available early; whether it is visible depends on the shell's use of the render model.
- The route constructs the retriever inside the stream generator after emitting the first status. It may lazily initialize database connections and create an embedding service per request before retrieval starts. Then retrieval is synchronous and waits for all enabled vector/graph/keyword branches (up to the configured total timeout) before the LLM stream is opened.
- No deployment logs or actual timing measurements are present in the workspace. Code contains timing logs for setup, retrieval branches, embedding, Milvus, and first answer token, but it does not log first thinking token, thinking completion, client receipt, or inter-token cadence.

## Open Questions
- Whether the frontend independently displays `sources`, `retrieval_stats`, or image data before the thinking stream finishes.
- Whether perceived slow output is dominated by retrieval, LLM first-token latency, client batching, or deliberate rendering cadence.
# Findings: Structured image-grounded QA responses

## Approved product behavior
- New answers use structured section/image bindings; `[[IMG:...]]` is not part of the new contract.
- Historical conversations do not need compatibility and may be deleted.
- Each answer section may contain zero or more relevant images.
- Images should be recalled with their text evidence, then validated before display.

## Initial architecture evidence
- Backend currently emits global `sources` before model tokens, then streams free-form `answer` text and may emit `answer_replaced` during finalization.
- `context_builder.py` already resolves image URLs, names, captions, descriptions, hints, document IDs, pages, and citations while building each source. This is the natural boundary for creating stable evidence/image records.
- Frontend currently injects images into Markdown through `image-injection-pipeline.ts` and the 885-line `inject-source-images.ts`; placement is driven by anchors, citations, intent, and appendix fallbacks.
- `sse-client.ts`, `types.ts`, `qa-store.ts`, and the answer renderer are all below the 600-line limit and can receive a structured section protocol without growing an oversized module.
- Several existing source modules exceed 600 lines. In particular, `inject-source-images.ts` is 885 lines; removing it is preferable to extending it. Avoid editing other oversized files unless they are split first.
- The approved structured path can avoid editing the 788-line `qa-shell.tsx`: the SSE handler can accept a validated `answer_document` event and deterministically compile its ordered sections/images into the existing message Markdown field.
- Stable citation labels already connect answer evidence to a retrieved source. Image placement can therefore bind images from the cited source to the same Markdown block; this is a formal reference-key relationship, not semantic regex guessing.
- The current image boost is still necessary for recall: it queries Mongo text search and only enters its keyword-regex fallback on exceptions. The new protocol must fix the empty-success case or image-bearing evidence will never reach section binding.
- `context_builder.py` currently flattens aligned image properties into parallel arrays and injects `[[IMG:...]]` catalogue lines into the model context. Replace this with a nested `images` collection carrying stable IDs while retaining the existing arrays only if other source UIs still need them.
- `postprocess_answer` explicitly normalizes/remaps IMG anchors. Those steps can be removed once the frontend injection code is gone; citation normalization remains the canonical evidence-reference protocol.
- Citation normalization can relabel sources (for example `1-2` to `1-1`); nested image ownership must be remapped in the same transaction or the answer-document validator will correctly reject every image on that source.
- Model-authored Markdown images are not trustworthy placement data. The final document strips them and renders only server-owned image records, preventing copied context URLs from bypassing ownership validation.
- The existing retrieval overview does not emit source citation labels, so it cannot consume/deduplicate images before the detailed cited sections receive them.
- Source normalization and streamed/final source merging both need to preserve the nested `images` collection; regression coverage now pins both paths.
- The current Markdown image component shows alt text only as accessibility metadata, so the structured compiler emits a visible caption immediately after each image to keep multiple images distinguishable.

## Baseline
- Backend focused image/stream suite: 21 passed.
- Frontend focused image suite: 7 passed after installing the locked dependencies in the isolated worktree.

---
