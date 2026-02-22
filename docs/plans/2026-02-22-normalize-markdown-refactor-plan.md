# QA Markdown Normalizer Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `normalizeAnswerMarkdownArtifacts` with a block-parser + classifier-led pipeline that fixes table/formula/heading/list instability and keeps streaming/final rendering consistent.

**Architecture:** Keep `normalizeAnswerMarkdownArtifacts(...)` API unchanged, but move internals to a two-stage engine: `parseBlocks` (code/math/table/heading-candidate/list/paragraph) + block-scoped normalization passes. Remove global cross-line heuristics that create side effects.

**Tech Stack:** TypeScript, ReactMarkdown, remark-gfm, remark-math, rehype-katex.

---

### Task 1: Build block parser foundation

**Files:**
- Create: `frontend/features/qa/formatting/markdown-block-parser.ts`
- Modify: `frontend/features/qa/formatting/index.ts`
- Modify: `frontend/lib/normalize-answer-markdown-artifacts.ts`

**Step 1:** Define `MarkdownBlockType` (`code`, `math`, `table`, `heading_candidate`, `list`, `paragraph`) and `MarkdownBlock` shape.

**Step 2:** Implement `parseMarkdownBlocks(text)` with deterministic line-based scan.

**Step 3:** Preserve protected regions (`code`, `math`, links/images) as immutable block content.

**Step 4:** Wire parser into `normalizeAnswerMarkdownArtifacts` behind existing API.

**Step 5:** Run `npm run build` in `frontend` and verify no call-site changes required.

---

### Task 2: Fix table/comment contamination in block scope

**Files:**
- Modify: `frontend/lib/normalize-answer-markdown-artifacts.ts`
- Optional create: `frontend/features/qa/formatting/table-normalizer.ts`

**Step 1:** Move loose-pipe table recovery to table-block pass (no full-text rewrite).

**Step 2:** Add table boundary rules so note/comment lines (e.g., `注：`, `说明：`) exit table context.

**Step 3:** Keep citation markers out of cell coercion when line is outside table block.

**Step 4:** Align streaming/final behavior: parser always runs; table rewrite stays conservative in streaming.

**Step 5:** Verify with current failing examples (comment should render below table, not inside cell).

---

### Task 3: Stabilize math rendering pipeline

**Files:**
- Modify: `frontend/lib/normalize-answer-markdown-artifacts.ts`
- Optional create: `frontend/features/qa/formatting/math-normalizer.ts`

**Step 1:** Restrict math cleanup to `math` blocks and math-like paragraph blocks only.

**Step 2:** Add conservative formula promotion rule for obvious bare LaTeX lines (`\frac`, `\sum`, `\times`, etc.) in non-streaming mode.

**Step 3:** Keep valid `$...$`/`$$...$$`/`\(...\)`/`\[...\]` untouched.

**Step 4:** Avoid destructive cleanup when braces are balanced and delimiters are valid.

**Step 5:** Verify with screenshot cases: no raw `\text{}` leaks, display formula style remains stable.

---

### Task 4: Classifier-led heading/list normalization

**Files:**
- Modify: `frontend/features/qa/formatting/heading-classifier.ts`
- Modify: `frontend/lib/normalize-answer-markdown-artifacts.ts`

**Step 1:** Run heading classifier only on `heading_candidate` blocks (not table/math/list blocks).

**Step 2:** Replace global `normalizeNumberedHeadingSequence` behavior with block-local logic.

**Step 3:** Apply list renumbering only inside list blocks.

**Step 4:** Keep clause/reference numbering intact in paragraph blocks.

**Step 5:** Verify numbered heading/list ordering in current failure samples.

---

### Task 5: Fix citation PDF hover-close bug (UI layer)

**Files:**
- Modify: `frontend/features/qa/citations/citation-pill.tsx`
- Modify: `frontend/components/qa-new/qa-shell.tsx`
- Optional modify: `frontend/components/qa-sources.tsx`

**Step 1:** Split citation state into hover state vs selected state.

**Step 2:** Make tooltip visibility controlled by hover state only.

**Step 3:** Keep click behavior for scroll/highlight, not sticky hover popup.

**Step 4:** Add robust close paths (`mouseleave`, `blur`, optional outside-click/escape).

**Step 5:** Manual verify: hover opens and reliably closes.

---

### Task 6: Remove legacy heuristic chain and verify

**Files:**
- Modify: `frontend/lib/normalize-answer-markdown-artifacts.ts`
- Modify (if needed): `docs/notes/normalize-answer-markdown-artifacts-analysis-2026-02-22.md`

**Step 1:** Delete obsolete global regex passes replaced by block passes.

**Step 2:** Keep diagnostics output (optional debug flag) for block counts + decisions.

**Step 3:** Run `npm run build` in `frontend`.

**Step 4:** Replay known problematic outputs manually (不新增测试文件) and record before/after notes.

**Step 5:** Report per-task delta to user and request go/no-go before next task.
