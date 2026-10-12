# Progress: QA streaming diagnosis

## 2026-08-16

### Phase 1: Root-cause investigation
- **Status:** in_progress
- Read the deployment handoff, repository rules, backend RAG stream implementation, and current stream-order regression test.
- Established that the backend deliberately emits the retrieval overview prior to invoking the model stream.
- Traced route-level SSE framing, production Nginx streaming settings, frontend SSE dispatch, state transitions, and output buffer.
- Confirmed Nginx/proxy buffering is disabled for the stream route; browser-frame batching is bounded to one frame for typical chunks.
- Next: summarize confirmed root causes and specify the runtime measurements required to attribute the remaining latency precisely.
# Progress: Structured image-grounded QA responses

## 2026-10-12

### Phase 1: Design and baseline
- **Status:** in_progress
- Read the approved behavior, repository constraints, existing stream orchestrator, context builder, SSE client, and Markdown image pipeline.
- Created isolated worktree `feat/structured-image-answer` under ignored `.worktrees/structured-image-answer`.
- Confirmed the current system uses global sources plus free-form answer tokens and post-hoc image injection; the replacement will bind verified image records to explicit answer sections.
- Next: finish the protocol design and run focused baseline tests before adding failing tests.
- Backend image/stream baseline passed: 21 tests, 0 failures.
- The first frontend baseline command used an incorrect relative path to the root dependency installation and did not run any regression script; retrying with the verified absolute executable path.
- The second lookup confirmed dependencies are installed under the main checkout's `frontend/node_modules`, not the repository root. No regression script ran on either failed invocation.
- The borrowed `tsx` executable ran one dependency-free regression, then correctly exposed that the isolated worktree lacked its own dependency tree. Following the worktree setup procedure, install the existing locked frontend dependencies locally before treating frontend results as a baseline.
- `npm install` completed in the isolated `frontend/` directory (788 packages); only an existing Node-engine warning and upstream deprecation notices were reported.
- Frontend image baseline then passed all 7 focused scripts.

---
