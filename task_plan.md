# Task Plan: PDF Open Without Answer Highlight

## Goal
Remove the QA PDF viewer behavior that automatically highlights answer/source text inside the opened PDF, so opening a source goes straight to the PDF and feels faster.

## Current Phase
Phase 1: root cause investigation

## Phases
### Phase 1: Root cause investigation
- [ ] Inspect PDF lightbox open flow and auto-highlight utilities
- [ ] Identify the smallest safe change that removes visible PDF marking and avoids unnecessary PDF text search
- **Status:** in_progress

### Phase 2: Failing regressions
- [ ] Add focused frontend regression for "opening PDF does not schedule auto-highlight"
- [ ] Confirm the regression fails before implementation
- **Status:** pending

### Phase 3: Minimal fix
- [ ] Remove auto-highlight scheduling from PDF open path
- [ ] Keep direct PDF URL/page opening behavior intact
- **Status:** pending

### Phase 4: Verification
- [ ] Run focused regression
- [ ] Run TypeScript check
- [ ] Update findings and progress
- **Status:** pending

## Working Hypothesis
The slow and marked PDF opening comes from `PdfLightbox` importing `pdf-auto-highlight` and calling `scheduleAutoPdfHighlight()` after the PDF document/page has loaded. That search/highlight pass should be removed from the default open flow.

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
