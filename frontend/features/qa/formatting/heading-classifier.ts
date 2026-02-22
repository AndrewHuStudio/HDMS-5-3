export type HeadingDecision = "heading" | "paragraph";

export interface HeadingClassifierContext {
  previousNonEmptyLine?: string;
  nextNonEmptyLine?: string;
  lineIndex?: number;
  totalLines?: number;
}

export interface HeadingClassification {
  decision: HeadingDecision;
  confidence: number;
  score: number;
  reasons: string[];
}

const SENTENCE_PUNCT_RE = /[，,:：；。！？.!?]/g;
const SENTENCE_END_RE = /[。！？.!?；;:]$/;
const STRUCTURED_HEADING_PREFIX_RE =
  /^(?:#{1,6}\s+|[一二三四五六七八九十]+[、.．]\s*|[（(][一二三四五六七八九十]+[)）]\s*|\d{1,2}[.、．]\s+)/;
const INLINE_HEADING_SPLIT_RE = /^(#{1,6}\s+|[一二三四五六七八九十]+[、.．]\s*|[（(][一二三四五六七八九十]+[)）]\s*|\d{1,2}[.、．]\s*)/;

const LIST_LINE_RE = /^(\s*)(?:[-*+]\s+|\d+[.)]\s+)/;
const NUMBERED_SECTION_LINE_RE = /^\d{1,2}[.、．]\s*\S+/;
const CAPTION_LIKE_RE = /^(?:图|表)\s*\d+(?:\.\d+)*\s*[：:]/;
const MARKDOWN_HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const HEADING_DECISION_THRESHOLD = 0.35;
const HIGH_CONFIDENCE_MARGIN = 0.35;

function normalizeLine(line: string): string {
  return (line || "").trim();
}

function punctuationDensity(text: string): number {
  if (!text) return 0;
  const punctCount = (text.match(SENTENCE_PUNCT_RE) || []).length;
  return punctCount / Math.max(text.length, 1);
}

function separatorDensity(text: string): number {
  if (!text) return 0;
  const separatorCount = (text.match(/[|｜]+/g) || []).join("").length;
  return separatorCount / Math.max(text.length, 1);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function decisionConfidence(score: number): number {
  const margin = Math.abs(score - HEADING_DECISION_THRESHOLD);
  return clamp01(margin / HIGH_CONFIDENCE_MARGIN);
}

export function looksLikeHeadingPrefix(line: string): boolean {
  return STRUCTURED_HEADING_PREFIX_RE.test(normalizeLine(line));
}

export function splitInlineHeadingAndBody(line: string): string {
  const raw = line || "";
  const trimmed = raw.trim();
  if (!trimmed) return line;
  if (!looksLikeHeadingPrefix(trimmed)) return line;

  const prefixMatch = trimmed.match(INLINE_HEADING_SPLIT_RE);
  if (!prefixMatch) return line;
  const prefix = prefixMatch[0];
  const tail = trimmed.slice(prefix.length).trim();
  if (!tail) return line;

  const pipeSegments = tail
    .split(/[|｜]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const looksLikeInlineEnumeration =
    pipeSegments.length >= 2 &&
    pipeSegments.every((segment) => segment.length > 0 && segment.length <= 12) &&
    pipeSegments.every((segment) => !/[。！？.!?；;:]$/.test(segment));
  if (looksLikeInlineEnumeration) return line;

  const numberedRunOn = tail.match(/^(.*?)(\d{1,2}[.．](?=[^\s\d]).*)$/);
  if (numberedRunOn) {
    const headingBody = (numberedRunOn[1] || "").trimEnd();
    const remainder = (numberedRunOn[2] || "").trimStart();
    if (
      headingBody &&
      remainder &&
      !/\d$/.test(headingBody) &&
      /[\u4e00-\u9fffA-Za-z）)]$/.test(headingBody)
    ) {
      return `${`${prefix}${headingBody}`.trimEnd()}\n${remainder}`;
    }
  }

  const firstPipe = tail.search(/[|｜]/);
  if (firstPipe <= 10) return line;

  const headingBody = tail.slice(0, firstPipe).trim();
  const remainder = tail.slice(firstPipe).replace(/^[|｜\s]+/, "").trim();
  if (!headingBody || !remainder) return line;
  if (remainder.length < 14 && !/[，,:：；。！？.!?]/.test(remainder)) return line;

  // Skip split if the first chunk already looks like a full sentence.
  if (SENTENCE_END_RE.test(headingBody) || headingBody.length < 6) return line;

  const headingLine = `${prefix}${headingBody}`.trimEnd();
  return `${headingLine}\n${remainder}`;
}

/**
 * Score whether a single line should be treated as a heading candidate.
 *
 * This classifier is intentionally deterministic and explainable:
 * - positive score => heading
 * - negative score => paragraph
 */
export function classifyHeadingCandidate(
  line: string,
  context: HeadingClassifierContext = {},
): HeadingClassification {
  const text = normalizeLine(line);
  const prev = normalizeLine(context.previousNonEmptyLine || "");
  const next = normalizeLine(context.nextNonEmptyLine || "");
  const reasons: string[] = [];
  let score = 0;

  if (!text) {
    return {
      decision: "paragraph",
      confidence: 1,
      score: -1,
      reasons: ["empty-line"],
    };
  }

  if (STRUCTURED_HEADING_PREFIX_RE.test(text)) {
    score += 0.38;
    reasons.push("structured-prefix");
  }

  if (MARKDOWN_HEADING_RE.test(text)) {
    score += 0.14;
    reasons.push("markdown-heading-prefix");
  }

  if (CAPTION_LIKE_RE.test(text)) {
    score -= 0.7;
    reasons.push("caption-like-line");
  }

  const punctDensity = punctuationDensity(text);
  if (punctDensity >= 0.1) {
    score -= 0.42;
    reasons.push("high-punctuation-density");
  } else if (punctDensity >= 0.065) {
    score -= 0.2;
    reasons.push("medium-punctuation-density");
  }

  const sepDensity = separatorDensity(text);
  if (sepDensity >= 0.05) {
    score -= 0.55;
    reasons.push("high-separator-density");
  }

  if (text.length >= 70) {
    score -= 0.3;
    reasons.push("very-long-line");
  } else if (text.length >= 52) {
    score -= 0.16;
    reasons.push("long-line");
  }

  if (SENTENCE_END_RE.test(text)) {
    score -= 0.24;
    reasons.push("sentence-like-ending");
  }

  if (!prev) {
    score += 0.08;
    reasons.push("starts-after-blank");
  }

  if (next && LIST_LINE_RE.test(next)) {
    score += 0.12;
    reasons.push("followed-by-list");
  }

  if (next && !LIST_LINE_RE.test(next) && punctDensity >= 0.05) {
    score -= 0.12;
    reasons.push("followed-by-paragraph");
  }

  if (NUMBERED_SECTION_LINE_RE.test(text)) {
    const prevIsNumbered = Boolean(prev && NUMBERED_SECTION_LINE_RE.test(prev));
    const nextIsNumbered = Boolean(next && NUMBERED_SECTION_LINE_RE.test(next));
    if (prevIsNumbered || nextIsNumbered) {
      score -= 0.24;
      reasons.push("likely-numbered-list-block");
    }
  }

  if (typeof context.lineIndex === "number" && context.lineIndex >= 0 && context.lineIndex <= 2) {
    score += 0.04;
    reasons.push("near-document-start");
  }

  const confidence = decisionConfidence(score);
  return {
    decision: score >= HEADING_DECISION_THRESHOLD ? "heading" : "paragraph",
    confidence,
    score,
    reasons,
  };
}
