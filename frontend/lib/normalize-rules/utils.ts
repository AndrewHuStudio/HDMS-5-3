/**
 * Shared utility functions and regex patterns used across normalize rules.
 * Migrated from normalize-answer-markdown-artifacts.ts.
 */

import type { NormalizationDiagnostics } from "./types";

// ---------------------------------------------------------------------------
// Core regex patterns
// ---------------------------------------------------------------------------

/** Matches code blocks (fenced + inline). */
export const INLINE_OR_FENCED_CODE_RE = /(```[\s\S]*?```|`[^`\n]*`)/g;

/**
 * Matches LaTeX delimiters ($...$, $$...$$), code blocks, and markdown
 * links/images. Used to split text so destructive normalizations skip
 * protected regions.
 */
export const PROTECTED_REGION_RE =
  /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|```[\s\S]*?```|`[^`\n]*`|!\[[^\]\n]*\]\([^)\n]*\)|\[[^\]\n]+\]\([^)\n]*\))/g;

/** Matches code blocks and dollar-math regions. */
export const CODE_OR_DOLLAR_MATH_RE =
  /(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;

// ---------------------------------------------------------------------------
// Diagnostics helpers
// ---------------------------------------------------------------------------

export function createDiagnostics(enabled: boolean): NormalizationDiagnostics {
  return {
    enabled,
    counters: {},
    heading: {
      heading: 0,
      paragraph: 0,
      reasons: {},
    },
  };
}

export function bumpCounter(diag: NormalizationDiagnostics, key: string, by = 1): void {
  if (!diag.enabled) return;
  diag.counters[key] = (diag.counters[key] || 0) + by;
}

export function bumpIfChanged(
  diag: NormalizationDiagnostics,
  key: string,
  before: string,
  after: string,
): void {
  if (!diag.enabled) return;
  if (before !== after) bumpCounter(diag, key);
}

export function recordHeadingDecision(
  diag: NormalizationDiagnostics,
  decision: "heading" | "paragraph",
  reasons: string[],
): void {
  if (!diag.enabled) return;
  if (decision === "heading") diag.heading.heading += 1;
  else diag.heading.paragraph += 1;
  for (const reason of reasons) {
    diag.heading.reasons[reason] = (diag.heading.reasons[reason] || 0) + 1;
  }
}

// ---------------------------------------------------------------------------
// Protected-region transform helpers
// ---------------------------------------------------------------------------

/**
 * Apply a transform function only to unprotected segments of text,
 * leaving LaTeX formulas, code blocks, images, and links untouched.
 */
export function transformUnprotected(text: string, fn: (segment: string) => string): string {
  const segments = text.split(PROTECTED_REGION_RE);
  return segments
    .map((segment, index) => (index % 2 === 1 ? segment : fn(segment)))
    .join("");
}

/**
 * Apply a transform function only outside code blocks and dollar-math regions.
 */
export function transformOutsideCodeAndDollarMath(
  text: string,
  fn: (segment: string) => string,
): string {
  const segments = text.split(CODE_OR_DOLLAR_MATH_RE);
  return segments
    .map((segment, index) => (index % 2 === 1 ? segment : fn(segment)))
    .join("");
}
