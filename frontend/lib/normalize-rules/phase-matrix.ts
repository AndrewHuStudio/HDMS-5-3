/**
 * 阶段矩阵 - 声明式规则调度表
 * 核心原则："输出过程即结果" — streaming 和 final 必须产出相同结果。
 *
 * 所有规则统一在所有阶段执行（ALL），唯一例外是那些在不完整内容上
 * 会导致结构性破坏的规则（如 section-scaffold 会凭空插入 H2 标题）。
 * 这些规则保留为 FINAL_ONLY，但由于 buildAnswerMarkdown 已统一管线，
 * 它们在 streaming 阶段不会被调用（phase 始终传入实际阶段）。
 */
import type { NormalizePhase } from "./types";

const ALL: Set<NormalizePhase> = new Set(["streaming", "finalizing", "final"]);
const FINAL_ONLY: Set<NormalizePhase> = new Set(["final"]);

export const PHASE_MATRIX: Record<string, Set<NormalizePhase>> = {
  // ── All phases — lightweight safety rules ──
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
  "list-table-blank-lines":     ALL,
  "unicode-bullets":            ALL,
  "heading-blank-lines":        ALL,
  "list-blank-lines":           ALL,
  "numeric-range-delimiters":   ALL,

  // ── All phases — medium-weight rewrite rules ──
  "chinese-headings":           ALL,
  "heading-hierarchy":          ALL,
  "list-nesting":               ALL,
  "mixed-list-stabilization":   ALL,
  "list-numbering":             ALL,
  "heading-sequence":           ALL,
  "retrieval-overview-cleanup": ALL,
  "related-concepts-body":      ALL,
  "table-refs":                 ALL,
  "section-artifacts":          ALL,

  // ── Final only — heavy structural rules that assume complete content ──
  // These rules restructure the document (inject headings, promote sections)
  // and would cause layout jitter on incomplete streaming content.
  // Since buildAnswerMarkdown passes the actual phase, these only run at final.
  "dedupe-retrieval-overview":  FINAL_ONLY,
  "section-scaffold":           FINAL_ONLY,
  "formula-promotion":          FINAL_ONLY,
  "conclusion-heading":         FINAL_ONLY,
  "broken-inline-math":         FINAL_ONLY,

  // ── Conditional (guarded by preserveInlineFigureRefs) ──
  "figure-refs":                ALL,
};
