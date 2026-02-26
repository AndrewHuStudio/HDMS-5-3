/**
 * Compatibility entry point for normalizeAnswerMarkdownArtifacts.
 *
 * The monolithic 1766-line implementation has been refactored into modular
 * rules under `./normalize-rules/`. This file preserves the original public
 * API so existing callers (qa-shell.tsx, markdown-normalization-pipeline.ts)
 * continue to work without changes.
 */

import { runNormalizationPipeline } from "./normalize-rules";

export { normalizeMarkdownLists } from "./normalize-rules/rules/list-numbering";

export interface NormalizeAnswerMarkdownArtifactsOptions {
  streaming?: boolean;
  preserveInlineFigureRefs?: boolean;
  debugDiagnostics?: boolean;
}

export function normalizeAnswerMarkdownArtifacts(
  text: string,
  options: NormalizeAnswerMarkdownArtifactsOptions = {},
): string {
  const phase = options.streaming ? "streaming" : "final";
  return runNormalizationPipeline(text, {
    phase,
    preserveInlineFigureRefs: options.preserveInlineFigureRefs,
    debugDiagnostics: options.debugDiagnostics,
  });
}
