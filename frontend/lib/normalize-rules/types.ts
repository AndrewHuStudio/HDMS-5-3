export type NormalizePhase = "streaming" | "final";

export type NormalizationDiagnostics = {
  enabled: boolean;
  counters: Record<string, number>;
  heading: {
    heading: number;
    paragraph: number;
    reasons: Record<string, number>;
  };
};

export interface NormalizeContext {
  phase: NormalizePhase;
  diagnostics: NormalizationDiagnostics;
  /** Original input text (for diagnostics diff). */
  originalText: string;
}

export interface NormalizeRule {
  /** Unique ID used for PHASE_MATRIX lookup and diagnostics. */
  id: string;
  /** Execution order weight — lower runs first. */
  order: number;
  /** Rule transform function. */
  apply(text: string, ctx: NormalizeContext): string;
}
