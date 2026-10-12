# Structured Image-Grounded QA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `[[IMG:...]]` image placement with a validated structured answer document whose sections contain the images retrieved with their cited evidence.

**Architecture:** Build stable nested image evidence in backend sources, finalize streamed Markdown into citation-keyed answer sections, and emit an `answer_document` SSE event. The frontend deterministically compiles those sections into the existing Markdown renderer and deletes the legacy image-injection path.

**Tech Stack:** Python 3, FastAPI/SSE, Pydantic, pytest, TypeScript, React/Next.js, tsx regression scripts.

---

### Task 1: Stable image evidence records

**Files:**
- Create: `backend/qa_assistant/rag/image_evidence.py`
- Modify: `backend/qa_assistant/rag/context_builder.py`
- Modify: `backend/qa_assistant/schemas/rag_schemas.py`
- Test: `backend/qa_assistant/tests/test_structured_image_evidence.py`

**Step 1: Write the failing test**

Assert that a retrieved chunk with two image refs exposes two nested `images` records with stable distinct IDs, aligned captions/hints, URLs, source labels, document ID, and page.

**Step 2: Run test to verify it fails**

Run: `python -m pytest backend/qa_assistant/tests/test_structured_image_evidence.py -q`

Expected: FAIL because sources do not expose nested image evidence.

**Step 3: Write minimal implementation**

Add a small image-evidence helper that hashes document ID plus image URL, validates fields, and builds aligned records. Use it after the final citation label is known in `context_builder.py`. Add matching Pydantic schema fields.

**Step 4: Run test to verify it passes**

Run the same pytest target. Expected: PASS.

### Task 2: Recall image-bearing evidence on an empty text-search result

**Files:**
- Modify: `backend/qa_assistant/rag/retrieval_helpers.py`
- Test: `backend/qa_assistant/tests/test_image_recall.py`

**Step 1: Write the failing test**

Use a fake Mongo adapter whose text search succeeds with `[]` and whose bounded keyword query returns an image chunk. Assert the chunk is returned once.

**Step 2: Run test to verify it fails**

Run: `python -m pytest backend/qa_assistant/tests/test_image_recall.py -q`

Expected: FAIL because fallback currently runs only on exceptions.

**Step 3: Write minimal implementation**

Run the bounded fallback when text search is empty as well as when it raises. Merge and deduplicate records by chunk ID. Keep this as recall logic only.

**Step 4: Run test to verify it passes**

Run the same pytest target. Expected: PASS.

### Task 3: Build and stream a validated answer document

**Files:**
- Create: `backend/qa_assistant/rag/postprocess/answer_document.py`
- Modify: `backend/qa_assistant/rag/stream_orchestrator.py`
- Modify: `backend/qa_assistant/rag/postprocess/answer.py`
- Modify: `backend/qa_assistant/rag/prompting.py`
- Test: `backend/qa_assistant/tests/test_answer_document.py`
- Test: `backend/qa_assistant/tests/test_stream_answer_document.py`

**Step 1: Write failing section-binding tests**

Assert one cited section receives multiple source-owned images in order; duplicate IDs are emitted once; uncited and malformed images are excluded; Markdown blocks remain ordered.

**Step 2: Run tests to verify they fail**

Run both new pytest targets. Expected: FAIL because the builder/event do not exist.

**Step 3: Implement minimal builder and event**

Add a Markdown-aware block scanner and citation-key binding. After existing answer/citation finalization, always emit `answer_document` with sections and finalized sources, then `done`. Remove IMG-specific prompt and postprocessor behavior.

**Step 4: Run tests to verify they pass**

Run both new pytest targets. Expected: PASS.

### Task 4: Consume structured sections on the frontend

**Files:**
- Create: `frontend/features/qa/structured-answer-markdown.ts`
- Modify: `frontend/features/qa/types.ts`
- Modify: `frontend/lib/sse-client.ts`
- Modify: `frontend/features/qa/qa-view.tsx`
- Test: `frontend/scripts/qa-structured-answer-document-regression.ts`
- Test: `frontend/scripts/qa-structured-answer-sse-regression.ts`

**Step 1: Write failing regressions**

Assert that two images bound to one section render immediately after that section, a following section keeps its own image, invalid image records are omitted, and `answer_document` dispatches through the SSE callback.

**Step 2: Run tests to verify they fail**

Run each script with `frontend/node_modules/.bin/tsx.cmd`. Expected: FAIL because types, compiler, and callback do not exist.

**Step 3: Implement minimal consumer**

Add document/section/image types, an escaping/deduplicating Markdown compiler, SSE dispatch, and a QA view callback that replaces provisional streamed content with the structured final document.

**Step 4: Run tests to verify they pass**

Run both scripts. Expected: PASS.

### Task 5: Remove legacy IMG injection

**Files:**
- Modify: `frontend/features/qa/render/answer-markdown-pipeline.ts`
- Delete: `frontend/features/qa/render/image-injection-pipeline.ts`
- Delete: `frontend/lib/inject-source-images.ts`
- Delete/replace: legacy `frontend/scripts/qa-*-image-*-regression.*` scripts that assert anchor injection
- Modify/delete: backend tests that assert IMG catalogue/anchor behavior

**Step 1: Add an anchor-free contract test**

Assert active backend/frontend source contains no `[[IMG:` protocol and that ordinary Markdown/citation processing remains unchanged.

**Step 2: Verify RED**

Run the contract test/search. Expected: FAIL on current prompt, context builder, postprocessor, injection modules, and old regressions.

**Step 3: Remove legacy code**

Remove the image-injection call from the Markdown pipeline and delete now-dead anchor modules/tests. Preserve source sidebar image metadata and normal Markdown image rendering.

**Step 4: Verify GREEN**

Run structured regressions plus existing non-image answer/citation/table regressions. Expected: PASS and no active `[[IMG:` occurrences.

### Task 6: Full verification

**Files:**
- Modify: `task_plan.md`
- Modify: `findings.md`
- Modify: `progress.md`

**Step 1: Run backend tests**

Run focused QA suites, then the available backend QA test directory.

**Step 2: Run frontend checks**

Run structured regression scripts, relevant answer/citation/table scripts, TypeScript/lint, and production build if environment resources permit.

**Step 3: Run repository guards**

Run `scripts/check-module-lines.ps1`, `git diff --check`, source search for legacy anchors, and review `git diff --stat` plus `git status`.

**Step 4: Record evidence**

Update planning files with exact commands/results and report that production was not changed or deployed.
