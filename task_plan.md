# Task Plan: QA Graph Fusion and Image Return

## Goal
Fix QA so graph-backed retrieval can surface multiple relevant documents in the final reference list, and answers can return/render related images when retrieved chunks contain image references.

## Current Phase
Phase 4: verification complete

## Phases
### Phase 1: Root cause investigation
- [x] Inspect retrieval/context/source filtering path
- [x] Inspect image metadata to answer rendering path
- [x] Identify exact stage where extra graph/document/image sources disappear
- **Status:** complete

### Phase 2: Failing regressions
- [x] Add frontend regression for preserving streamed sources after answer replacement
- [x] Add frontend regression for image-intent answers appending related image sources
- [x] Add backend regression for source filtering preserving document/image assets
- [x] Confirm frontend regressions fail before implementation
- **Status:** complete

### Phase 3: Minimal fix
- [x] Keep multiple relevant document sources in final source list even when the generated answer cites only one label
- [x] Preserve image-bearing sources and image URLs through finalization
- [x] Keep changes scoped to modules under 600 lines, splitting before editing any over-limit file
- **Status:** complete

### Phase 4: Verification
- [x] Run focused regressions
- [x] Run affected QA backend/frontend checks
- [x] Run changed-file line limit check
- **Status:** complete

## Working Hypothesis
The retriever/context stage can build multiple document sources. The backend final source filter already allows uncited document sources, but the frontend source merge during `answer_replaced` replaced the source list with the final event payload and only preserved prior sources if they had image metadata. If the final event carried one cited source, other relevant sources disappeared from the rendered reference list.

For images, source metadata can include `image_urls`, but `image-injection-pipeline.ts` forced `allowAppendixFallback: false`. Therefore image-bearing sources were only rendered when the answer contained explicit figure refs or structured `[[IMG:N-M]]` markers. Common user phrasing like “返回图片” did not trigger any visible image when the model did not emit explicit image markers.

## Root Cause Confirmed
- `frontend/lib/stream-source-utils.ts` dropped previous non-image sources when `answer_replaced` supplied a narrower source list.
- `frontend/features/qa/render/image-injection-pipeline.ts` disabled the existing controlled image appendix fallback.
- The existing image intent recognizer did not treat “图片/图像/插图/图纸/图表/图示” as a strong image intent unless normalized to an existing trigger such as “配图”.

## Verification
- `npx --yes tsx scripts/qa-answer-replacement-preserves-stream-sources-regression.ts` failed before implementation with only 2 sources preserved, then passed.
- `npx --yes tsx scripts/qa-image-intent-appendix-regression.ts` failed before implementation with no `### 相关配图`, then passed.
- `python -m pytest backend\qa_assistant\tests\test_source_filter_preserves_fusion_assets.py backend\qa_assistant\tests\test_retrieval_document_diversity.py -q` passed.
- `npx --yes tsx scripts/qa-retrieval-overview-image-boundary-regression.ts` passed.
- `npx --yes tsx scripts/qa-streaming-equals-final-regression.tsx` passed.
- `node node_modules\typescript\bin\tsc --noEmit -p tsconfig.json` passed.
- `.\scripts\check-module-lines.ps1 -Path ...` passed for changed files.

## Constraints
- Do not edit source modules over 600 lines unless first splitting/extracting.
- Current over-limit QA files include `backend/qa_assistant/routes/qa.py`, `backend/qa_assistant/rag/service.py`, and `backend/qa_assistant/rag/retriever.py`.

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
