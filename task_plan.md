# Task Plan: QA streaming diagnosis

## Goal
Identify evidence-backed causes of the QA event-order defect and slow perceived streaming, without changing product code.

## Current Phase
Phase 1 — root-cause investigation

## Phases

### Phase 1: Trace backend and frontend event flow
- [x] Establish backend event ordering
- [x] Inspect API SSE serialization and client event handling
- [x] Identify buffering or deliberate display delays
- **Status:** complete

### Phase 2: Measure and compare runtime paths
- [x] Inspect configuration and existing timing evidence
- [x] Identify latency boundaries and likely dominant contributors
- **Status:** complete

### Phase 3: Report root causes and bounded fix options
- [x] Provide evidence and implementation scope
- **Status:** complete

## Constraints
- No production secrets or `.env` contents in output.
- No source changes during diagnosis.
- Any future source change must leave touched modules at or below 600 lines.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| None | 0 | — |
# Task Plan: Structured image-grounded QA responses

## Goal
Replace free-form `[[IMG:...]]` image placement with a structured evidence-and-section protocol so each streamed answer section carries zero or more verified images retrieved with its text.

## Current Phase
Complete — verified and ready for local handoff

## Phases

### Phase 1: Design, isolate, and establish baseline
- [x] Create an ignored Git worktree from `main`.
- [x] Record the approved architecture and implementation plan.
- [x] Run focused backend/frontend image-streaming baselines.
- **Status:** complete

### Phase 2: Backend protocol via TDD
- [x] Add failing tests for structured evidence image records and image recall.
- [x] Add failing tests for answer sections and stream events.
- [x] Implement stable image IDs, evidence bundles, and validated section/image bindings.
- [x] Remove new-answer `[[IMG:...]]` prompt/postprocessing behavior.
- **Status:** complete

### Phase 3: Frontend protocol via TDD
- [x] Add failing tests for structured section/image SSE handling and rendering.
- [x] Render images from section bindings without regex injection.
- [x] Remove legacy anchor injection modules and regressions.
- **Status:** complete

### Phase 4: Verification and handoff
- [x] Run focused and broader regression suites.
- [x] Verify every touched source module is at most 600 lines.
- [x] Review the complete diff and document deployment status.
- **Status:** complete

## Constraints
- Historical conversations may be discarded; no legacy `[[IMG:...]]` compatibility is required.
- A section may contain multiple relevant images.
- Prefer high recall in retrieval, but only render validated images from current evidence.
- Do not change production or push without separate authorization.
- Preserve unrelated work and keep touched source modules at or below 600 lines.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| PowerShell `Get-Content` treated `[chunkId]` as a wildcard in a line-count inventory | 1 | Use `-LiteralPath` for bracketed paths; the inventory still identified the relevant module sizes. |
| Frontend baseline invoked `tsx` one directory too shallow from the nested worktree | 1 | Inspect the actual installation before retrying; no regression script ran. |
| Assumed `tsx` was installed in the repository-root `node_modules`, but it is under `frontend/node_modules` | 2 | Use `E:/MyPrograms/HDMS/frontend/node_modules/.bin/tsx.cmd`; no project file was changed. |
| Borrowing the main checkout's `tsx` ran one dependency-free script but Node could not resolve React from the isolated worktree | 3 | Complete the worktree setup with `npm install` inside its `frontend/` directory before rerunning the baseline. |
| PowerShell passed Unix-style wildcard source paths literally to `rg` while listing retriever methods | 1 | Use explicit file paths or `--glob`; the needed method locations were still returned from `retriever.py`. |
| Full frontend QA regressions found `qa-final-structure-regression.tsx` failing its mixed-list assertion | 1 | Reproduced the identical failure on untouched `main`; record it as a pre-existing baseline failure and keep the image-protocol regressions independently green. |
| First legacy-protocol search placed `rg --glob` options after explicit paths, so PowerShell treated them as paths | 1 | Rerun with all `--glob` options before search roots; do not treat the errored output as evidence. |

---
