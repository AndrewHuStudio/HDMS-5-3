import type { NormalizePhase } from "./types";

/**
 * Declarative matrix: rule ID → which phases it runs in.
 * Replaces scattered `if (!streaming)` branches in the original monolith.
 */
export const PHASE_MATRIX: Record<string, Set<NormalizePhase>> = {
  // ── All phases (streaming + final) ──
  "strip-think-tags":           new Set(["streaming", "final"]),
  "strip-zero-width":           new Set(["streaming", "final"]),
  "rag-image-fix":              new Set(["streaming", "final"]),
  "block-parser":               new Set(["streaming", "final"]),
  "math-delimiters":            new Set(["streaming", "final"]),
  "image-math-unwrap":          new Set(["streaming", "final"]),
  "strip-unrenderable-images":  new Set(["streaming", "final"]),
  "fullwidth-asterisks":        new Set(["streaming", "final"]),
  "bold-whitespace":            new Set(["streaming", "final"]),
  "star-run-placeholders":      new Set(["streaming", "final"]),
  "split-run-on-items":         new Set(["streaming", "final"]),
  "split-inline-heading":       new Set(["streaming", "final"]),
  "loose-pipe-tables":          new Set(["streaming", "final"]),
  "chinese-headings":           new Set(["streaming", "final"]),
  "unicode-bullets":            new Set(["streaming", "final"]),
  "heading-blank-lines":        new Set(["streaming", "final"]),
  "list-blank-lines":           new Set(["streaming", "final"]),
  "list-numbering":             new Set(["streaming", "final"]),
  "heading-sequence":           new Set(["streaming", "final"]),
  "numeric-range-delimiters":   new Set(["streaming", "final"]),

  // ── Final phase only ──
  "related-concepts-body":      new Set(["final"]),
  "heading-hierarchy":          new Set(["final"]),
  "table-refs":                 new Set(["final"]),
  "section-artifacts":          new Set(["final"]),
  "section-scaffold":           new Set(["final"]),
  "formula-promotion":          new Set(["final"]),
  "conclusion-heading":         new Set(["final"]),
  "broken-inline-math":         new Set(["final"]),

  // ── Conditional (guarded by preserveInlineFigureRefs) ──
  "figure-refs":                new Set(["streaming", "final"]),
};
