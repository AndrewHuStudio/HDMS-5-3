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
