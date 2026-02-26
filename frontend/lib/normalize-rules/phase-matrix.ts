import type { NormalizePhase } from "./types";

const ALL: Set<NormalizePhase> = new Set(["streaming", "finalizing", "final"]);
const FINALIZING_UP: Set<NormalizePhase> = new Set(["finalizing", "final"]);
const FINAL_ONLY: Set<NormalizePhase> = new Set(["final"]);

/**
 * Declarative matrix: rule ID → which phases it runs in.
 *
 * Three-state strategy:
 *   streaming  — lightweight safety rules only (no layout rewrites)
 *   finalizing — medium-weight rules (heading/list normalization)
 *   final      — full rule set (scaffold, promotion, conclusion)
 */
export const PHASE_MATRIX: Record<string, Set<NormalizePhase>> = {
  // ── All phases (streaming + finalizing + final) — lightweight safety ──
  "strip-think-tags":           ALL,
  "strip-zero-width":           ALL,
  "rag-image-fix":              ALL,
  "block-parser":               ALL,
  "math-delimiters":            ALL,
  "image-math-unwrap":          ALL,
  "strip-unrenderable-images":  ALL,
  "fullwidth-asterisks":        ALL,
  "bold-whitespace":            ALL,
  "star-run-placeholders":      ALL,
  "strip-horizontal-rules":     ALL,
  "strip-strikethrough-markers": ALL,
  "split-run-on-items":         ALL,
  "split-inline-heading":       ALL,
  "loose-pipe-tables":          ALL,
  "unicode-bullets":            ALL,
  "heading-blank-lines":        ALL,
  "list-blank-lines":           ALL,
  "numeric-range-delimiters":   ALL,

  // ── Finalizing + final — medium-weight rewrite rules ──
  "chinese-headings":           FINALIZING_UP,
  "heading-hierarchy":          FINALIZING_UP,
  "list-numbering":             FINALIZING_UP,
  "heading-sequence":           FINALIZING_UP,
  "retrieval-overview-cleanup": FINALIZING_UP,
  "related-concepts-body":      FINALIZING_UP,
  "table-refs":                 FINALIZING_UP,
  "section-artifacts":          FINALIZING_UP,

  // ── Final only — heavy structural rules ──
  "dedupe-retrieval-overview":  FINAL_ONLY,
  "section-scaffold":           FINAL_ONLY,
  "formula-promotion":          FINAL_ONLY,
  "conclusion-heading":         FINAL_ONLY,
  "broken-inline-math":         FINAL_ONLY,

  // ── Conditional (guarded by preserveInlineFigureRefs) ──
  "figure-refs":                ALL,
};
