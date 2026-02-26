import type { SourceInfo } from "../features/qa/types";
import { normalizeCitationSources } from "./normalize-citation-sources";

function tryParseCitationAt(text: string, i: number): { label: string; next: number } | null {
  if (text[i] !== "[") return null;
  let j = i + 1;

  let a = "";
  while (j < text.length && /[0-9]/.test(text[j]) && a.length < 2) a += text[j++];
  if (a.length === 0) return null;
  if (text[j] !== "-") return null;
  j += 1;

  let b = "";
  while (j < text.length && /[0-9]/.test(text[j]) && b.length < 2) b += text[j++];
  if (b.length === 0) return null;
  if (text[j] !== "]") return null;

  return { label: `${a}-${b}`, next: j + 1 };
}

export function collectReferencedCitationLabels(text: string, sources: SourceInfo[]): Set<string> {
  const out = new Set<string>();
  if (!text || sources.length === 0) return out;

  const valid = new Set(sources.map((s) => s.citation_label).filter((v): v is string => Boolean(v)));
  if (valid.size === 0) return out;

  // Scan manually to avoid matching inside markdown links we injected ([1-1](#source-1-1)).
  // We only care about the original [1-1] tokens the LLM emits (or our fallback line).
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "[") continue;
    const parsed = tryParseCitationAt(text, i);
    if (!parsed) continue;
    if (valid.has(parsed.label)) out.add(parsed.label);
    i = parsed.next - 1;
  }

  return out;
}

export function alignSourcesToAnswer(text: string, sources: SourceInfo[]): SourceInfo[] {
  const canonical = normalizeCitationSources(sources);
  const referenced = collectReferencedCitationLabels(text, canonical);
  if (referenced.size === 0) return canonical;
  return canonical.filter((s) => s.citation_label && referenced.has(s.citation_label));
}

export function countReferencedCitations(text: string, sources: SourceInfo[]): number {
  return collectReferencedCitationLabels(text, sources).size;
}

