import type { SourceInfo } from "../features/qa/types";

function uniq<T>(items: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
  }
  return out;
}

function mergeNumberMin(a?: number, b?: number): number | undefined {
  if (typeof a !== "number" || !Number.isFinite(a)) return b;
  if (typeof b !== "number" || !Number.isFinite(b)) return a;
  return Math.min(a, b);
}

function mergeNumberMax(a?: number, b?: number): number | undefined {
  if (typeof a !== "number" || !Number.isFinite(a)) return b;
  if (typeof b !== "number" || !Number.isFinite(b)) return a;
  return Math.max(a, b);
}

/** True when two entries describe the same underlying chunk. */
function isSameChunk(a: SourceInfo, b: SourceInfo): boolean {
  const aId = a.chunk_id?.trim();
  const bId = b.chunk_id?.trim();
  if (aId && bId) return aId === bId;

  const aIds = Array.isArray(a.chunk_ids) ? a.chunk_ids.filter(Boolean) : [];
  const bIds = Array.isArray(b.chunk_ids) ? b.chunk_ids.filter(Boolean) : [];
  if (aIds.length > 0 && bIds.length > 0) {
    return aIds.some((id) => bIds.includes(id));
  }

  // No chunk identity available on either side: fall back to treating them as
  // the same entry, matching the historical merge behavior.
  return true;
}

/** Lowest "N-M" label for document N that no other entry has taken. */
function nextFreeLabel(label: string, taken: Set<string>): string {
  const sep = label.indexOf("-");
  if (sep <= 0) return label;
  const doc = label.slice(0, sep);
  let index = Number.parseInt(label.slice(sep + 1), 10);
  if (!Number.isFinite(index) || index < 1) index = 1;

  let candidate = `${doc}-${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${doc}-${index}`;
  }
  return candidate;
}

/**
 * UI-side normalization to ensure each citation_label maps to exactly one display card.
 * Backend can return duplicate citation labels (e.g. two entries with 2-2). That breaks:
 * - strict correspondence between answer markers and reference list items
 * - unique DOM ids (#source-2-2)
 *
 * Duplicates of the *same* chunk are merged. Duplicates that are actually
 * distinct chunks are kept and relabelled onto a free index instead — merging
 * them would drop a real citation and collapse its page number via min().
 */
export function normalizeCitationSources(sources: SourceInfo[]): SourceInfo[] {
  const out: SourceInfo[] = [];
  const byLabel = new Map<string, SourceInfo>();

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    let label = src.citation_label;

    // No label: keep as-is (these won't be linked from answer markers anyway).
    if (!label) {
      out.push(src);
      continue;
    }

    const collision = byLabel.get(label);
    if (collision && !isSameChunk(collision, src)) {
      // Distinct chunk wearing a taken label: give it its own card.
      label = nextFreeLabel(label, new Set(byLabel.keys()));
    }

    const existing = byLabel.get(label);
    if (!existing) {
      const cloned: SourceInfo = { ...src, citation_label: label };
      // Normalize chunk id collections up front.
      const ids = uniq([
        ...(Array.isArray(cloned.chunk_ids) ? cloned.chunk_ids : []),
        ...(cloned.chunk_id ? [cloned.chunk_id] : []),
      ].filter(Boolean));
      if (ids.length > 0) cloned.chunk_ids = ids;
      byLabel.set(label, cloned);
      out.push(cloned);
      continue;
    }

    // Merge duplicates into the first appearance.
    const merged: SourceInfo = existing;
    const ids = uniq([
      ...(Array.isArray(merged.chunk_ids) ? merged.chunk_ids : []),
      ...(Array.isArray(src.chunk_ids) ? src.chunk_ids : []),
      ...(merged.chunk_id ? [merged.chunk_id] : []),
      ...(src.chunk_id ? [src.chunk_id] : []),
    ].filter(Boolean));
    if (ids.length > 0) merged.chunk_ids = ids;

    const minPage = mergeNumberMin(merged.page, src.page);
    const maxPage = mergeNumberMax(
      merged.page_end ?? merged.page,
      src.page_end ?? src.page
    );
    merged.page = minPage;
    if (typeof maxPage === "number") merged.page_end = maxPage;

    merged.score = mergeNumberMax(merged.score, src.score);

    // Prefer first non-empty text fields, but keep existing if already set.
    if (!merged.section && src.section) merged.section = src.section;
    if (!merged.quote && src.quote) merged.quote = src.quote;

    // Merge image metadata lists.
    merged.image_urls = uniq([
      ...(Array.isArray(merged.image_urls) ? merged.image_urls : []),
      ...(Array.isArray(src.image_urls) ? src.image_urls : []),
      ...(merged.image_url ? [merged.image_url] : []),
      ...(src.image_url ? [src.image_url] : []),
    ].filter(Boolean));
    merged.image_names = uniq([
      ...(Array.isArray(merged.image_names) ? merged.image_names : []),
      ...(Array.isArray(src.image_names) ? src.image_names : []),
      ...(merged.image_name ? [merged.image_name] : []),
      ...(src.image_name ? [src.image_name] : []),
    ].filter(Boolean));
    merged.image_figures = uniq([
      ...(Array.isArray(merged.image_figures) ? merged.image_figures : []),
      ...(Array.isArray(src.image_figures) ? src.image_figures : []),
    ].filter(Boolean));
    merged.image_captions = uniq([
      ...(Array.isArray(merged.image_captions) ? merged.image_captions : []),
      ...(Array.isArray(src.image_captions) ? src.image_captions : []),
    ].filter(Boolean));
  }

  return out;
}
