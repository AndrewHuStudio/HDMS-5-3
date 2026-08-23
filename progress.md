# Progress: QA streaming diagnosis

## 2026-08-16

### Phase 1: Root-cause investigation
- **Status:** in_progress
- Read the deployment handoff, repository rules, backend RAG stream implementation, and current stream-order regression test.
- Established that the backend deliberately emits the retrieval overview prior to invoking the model stream.
- Traced route-level SSE framing, production Nginx streaming settings, frontend SSE dispatch, state transitions, and output buffer.
- Confirmed Nginx/proxy buffering is disabled for the stream route; browser-frame batching is bounded to one frame for typical chunks.
- Next: summarize confirmed root causes and specify the runtime measurements required to attribute the remaining latency precisely.
