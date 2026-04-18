/**
 * Modular normalization pipeline engine.
 *
 * Iterates registered rules filtered by the PHASE_MATRIX, applying each
 * transform in order. This replaces the monolithic 1766-line function.
 */

import { PHASE_MATRIX } from "./phase-matrix";
import { allRules } from "./registry";
import type { NormalizeContext, NormalizePhase } from "./types";
import { bumpIfChanged, createDiagnostics } from "./utils";

// -- Batch 1: simple, dependency-free rules --
import "./rules/strip-artifacts";
import "./rules/text-cleanup";
import "./rules/line-artifacts";
import "./rules/heading-blank-lines";
import "./rules/numeric-range";

// -- Batch 2: image / math rules --
import "./rules/rag-image-fix";
import "./rules/math-delimiters";
import "./rules/image-cleanup";
import "./rules/formula-promotion";
import "./rules/broken-math";

// -- Batch 3: list / table / reference rules --
import "./rules/block-parser";
import "./rules/list-splitting";
import "./rules/table-normalization";
import "./rules/list-numbering";
import "./rules/list-nesting";
import "./rules/figure-refs";

// -- Batch 4: heading / structure rules --
import "./rules/chinese-headings";
import "./rules/related-concepts";
import "./rules/heading-hierarchy";
import "./rules/section-scaffold";
import "./rules/conclusion-heading";

export type { NormalizePhase, NormalizeContext, NormalizeRule } from "./types";
export type { NormalizationDiagnostics } from "./types";

export interface RunPipelineOptions {
  phase: NormalizePhase;
  preserveInlineFigureRefs?: boolean;
  debugDiagnostics?: boolean;
}

export function runNormalizationPipeline(
  text: string,
  options: RunPipelineOptions,
): string {
  if (!text) return text;

  const { phase, preserveInlineFigureRefs = true, debugDiagnostics = false } = options;
  const ctx: NormalizeContext = {
    phase,
    diagnostics: createDiagnostics(debugDiagnostics),
    originalText: text,
  };

  let out = text;
  for (const rule of allRules) {
    const allowedPhases = PHASE_MATRIX[rule.id];
    if (!allowedPhases?.has(phase)) continue;

    // Conditional guard
    if (rule.id === "figure-refs" && preserveInlineFigureRefs) continue;

    const before = out;
    out = rule.apply(out, ctx);
    bumpIfChanged(ctx.diagnostics, rule.id, before, out);
  }

  if (ctx.diagnostics.enabled) {
    // eslint-disable-next-line no-console
    console.debug("[normalize-rules]", ctx.diagnostics);
  }

  return out;
}
