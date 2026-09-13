# ICP Filing Footer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display the confirmed service filing number on every HDMS page and link it to the MIIT filing system.

**Architecture:** Add a small server component for the filing link and render it once from the Next.js root layout. Use fixed bottom-left positioning because the application shell owns a full-height, overflow-hidden viewport.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Node/tsx regression scripts.

---

### Task 1: Add a failing filing-link regression test

**Files:**
- Create: `frontend/scripts/site-filing-link-regression.tsx`

**Step 1: Write the failing test**

Add assertions that the component exists, renders `赣ICP备2026022319号-1`, points to `https://beian.miit.gov.cn/`, uses safe new-window attributes, stays at the bottom-left edge, and is rendered by the root layout.

**Step 2: Run test to verify it fails**

Run: `npx tsx scripts/site-filing-link-regression.tsx`

Expected: FAIL because `components/site-filing-link.tsx` does not exist.

### Task 2: Implement the site-wide filing link

**Files:**
- Create: `frontend/components/site-filing-link.tsx`
- Modify: `frontend/app/layout.tsx`

**Step 1: Write minimal implementation**

Create `SiteFilingLink` with the confirmed filing number and official MIIT URL, then render it from `RootLayout`.

**Step 2: Run targeted verification**

Run: `npx tsx scripts/site-filing-link-regression.tsx`

Expected: PASS.

Run: `npx eslint app/layout.tsx components/site-filing-link.tsx scripts/site-filing-link-regression.tsx`

Expected: no errors or warnings.

### Task 3: Validate and deliver

**Files:**
- Verify all touched source files.

**Step 1: Run production build**

Run: `npm run build`

Expected: successful Next.js production build.

**Step 2: Verify module line limits**

Run: `powershell -ExecutionPolicy Bypass -File ../scripts/check-module-lines.ps1`

Expected: all touched source modules are at or below 600 lines.

**Step 3: Commit, integrate, and deploy**

Commit the feature branch, integrate it into `main` without touching unrelated dirty files, and push `main`. Verify the GitHub Actions deployment and the public site footer before reporting success.
