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
- **Status:** complete
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

### Phase 2: Backend protocol via TDD
- **Status:** complete
- RED: structured image evidence test failed with missing source `images` field.
- GREEN: added stable nested image records keyed by document/image identity; focused test passes 1/1.
- RED: empty-success Mongo text search returned no image chunks and never called the bounded fallback.
- GREEN: empty results now enter the existing bounded recall fallback; both new backend tests pass 2/2.
- RED/GREEN: answer-document tests progressed from a missing module, to three intended assertion failures, to 3/3 passing with ordered block binding, ownership validation, and global image deduplication.
- RED/GREEN: backend prompt/context contract failed on IMG catalogue text, then passed after removing anchor instructions and catalogue output.
- RED/GREEN: model-authored Markdown images initially bypassed structured evidence; final answer blocks now strip those URLs and expose only validated image records.
- Stream stability's legacy `answer_replaced` expectation failed as intended and now validates the ordered `answer_document` replacement.

### Phase 3: Frontend protocol via TDD
- **Status:** complete
- RED/GREEN: structured document compiler now renders multiple owned images after their section, rejects wrong-owner images, and deduplicates stable IDs.
- RED/GREEN: SSE client now dispatches `answer_document`; QA view wiring compiles it and stages it as the authoritative final answer.
- RED/GREEN: active frontend answer rendering no longer calls image injection or scores IMG anchors.
- Deleted the 885-line heuristic injector, its wrapper, and seven anchor-specific regression scripts.

### Phase 4: Verification and handoff
- **Status:** complete
- Backend QA suite passed 44/44.
- Frontend QA regression sweep passed every executed script except `qa-final-structure-regression.tsx`. The identical mixed-list failure reproduces on untouched `main`, so it is a pre-existing baseline defect rather than a structured-image regression.
- Frontend production build passed, including compilation, TypeScript, page generation, and route finalization.
- Frontend regression sweep excluding the independently reproduced pre-existing mixed-list failure passed 49/49.
- TypeScript `--noEmit` and targeted ESLint for all changed TypeScript/TSX files passed.
- Changed-module line check passed with every touched source file at or below 600 lines.
- Active backend/frontend source contains no legacy `[[IMG:...]]` protocol or heuristic injector references.
- `git diff --check` passed; only Git's expected LF/CRLF conversion notices were emitted.
- Work remains isolated on `feat/structured-image-answer`; nothing was pushed or deployed.

---
