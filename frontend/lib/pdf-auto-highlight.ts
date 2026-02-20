import type { SourceInfo } from "@/features/qa/types";

type SearchCandidateInput = {
  quote?: string | null;
  section?: string | null;
  query?: string | null;
};

type ScheduleAutoPdfHighlightArgs = {
  candidates: string[];
  highlight: (keyword: string) => Promise<unknown[]>;
  clearHighlights: () => void;
  delayMs?: number;
  clearAfterMs?: number;
  onMatched?: (keyword: string, matchCount: number) => void;
  onNotMatched?: () => void;
};

const MAX_PRIMARY_LEN = 120;
const MIN_CANDIDATE_LEN = 2;
const MAX_CANDIDATE_LEN = 60;
const MAX_CANDIDATES = 8;

const SENTENCE_SPLIT_RE = /[。！？!?；;:\n\r]+/g;
const SPACE_RE = /\s+/g;
const PAGE_MARKER_RE = /<!--\s*PAGE\s*\d+\s*-->/gi;

function stripMarkup(text: string): string {
  return text
    .replace(PAGE_MARKER_RE, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_#>|~]/g, " ")
    .replace(SPACE_RE, " ")
    .trim();
}

function cleanSearchText(text: string): string {
  return text
    .replace(/[^0-9A-Za-z\u4e00-\u9fff\s]/g, " ")
    .replace(SPACE_RE, " ")
    .trim();
}

function clampText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trim();
}

function addCandidate(list: string[], seen: Set<string>, raw: string): void {
  const cleaned = cleanSearchText(raw);
  if (cleaned.length < MIN_CANDIDATE_LEN) return;
  const clipped = cleaned.length > MAX_CANDIDATE_LEN ? clampText(cleaned, MAX_CANDIDATE_LEN) : cleaned;
  if (clipped.length < MIN_CANDIDATE_LEN || seen.has(clipped)) return;
  seen.add(clipped);
  list.push(clipped);
}

export function resolvePdfSearchKeyword(
  source?: Pick<SourceInfo, "quote" | "section"> | null,
  fallbackText?: string | null,
): string | undefined {
  const fromQuote = String(source?.quote ?? "").trim();
  if (fromQuote) return fromQuote;
  const fromFallback = String(fallbackText ?? "").trim();
  if (fromFallback) return fromFallback;
  const fromSection = String(source?.section ?? "").trim();
  if (fromSection) return fromSection;
  return undefined;
}

export function buildPdfSearchCandidates(input: SearchCandidateInput): string[] {
  const base = stripMarkup(String(input.quote ?? ""));
  const section = stripMarkup(String(input.section ?? ""));
  const query = stripMarkup(String(input.query ?? ""));
  const primary = cleanSearchText(base);

  const candidates: string[] = [];
  const seen = new Set<string>();

  if (primary) {
    addCandidate(candidates, seen, clampText(primary, MAX_PRIMARY_LEN));
  }

  const sentenceParts = base
    .split(SENTENCE_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const part of sentenceParts) {
    addCandidate(candidates, seen, part);
    if (candidates.length >= MAX_CANDIDATES) return candidates;
  }

  const zhRuns = primary.match(/[\u4e00-\u9fff]{4,}/g) ?? [];
  for (const run of zhRuns) {
    addCandidate(candidates, seen, run);
    if (candidates.length >= MAX_CANDIDATES) return candidates;
  }

  addCandidate(candidates, seen, section);
  if (candidates.length >= MAX_CANDIDATES) return candidates;
  addCandidate(candidates, seen, query);

  return candidates.slice(0, MAX_CANDIDATES);
}

export function scheduleAutoPdfHighlight(args: ScheduleAutoPdfHighlightArgs): () => void {
  const {
    candidates,
    highlight,
    clearHighlights,
    delayMs = 1200,
    clearAfterMs = 5000,
    onMatched,
    onNotMatched,
  } = args;

  let cancelled = false;
  let runTimer: ReturnType<typeof setTimeout> | null = null;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  const run = async () => {
    for (const keyword of candidates) {
      if (cancelled) return;

      try {
        const matches = await highlight(keyword);
        const matchCount = Array.isArray(matches) ? matches.length : 0;
        if (matchCount > 0) {
          onMatched?.(keyword, matchCount);
          if (clearAfterMs > 0) {
            clearTimer = setTimeout(() => {
              if (!cancelled) {
                clearHighlights();
              }
            }, clearAfterMs);
          }
          return;
        }
      } catch {
        // Continue trying shorter candidates.
      }
    }

    onNotMatched?.();
  };

  runTimer = setTimeout(() => {
    void run();
  }, delayMs);

  return () => {
    cancelled = true;
    if (runTimer) clearTimeout(runTimer);
    if (clearTimer) clearTimeout(clearTimer);
  };
}

