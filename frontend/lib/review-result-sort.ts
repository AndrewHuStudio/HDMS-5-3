export type ReviewItemStatus = "pass" | "fail" | "unknown";

const statusRank: Record<ReviewItemStatus, number> = {
  pass: 0,
  fail: 1,
  unknown: 2,
};

export function extractSortIndex(value?: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const match = value.match(/\d+/g);
  if (!match || match.length === 0) return Number.POSITIVE_INFINITY;
  const last = Number.parseInt(match[match.length - 1], 10);
  return Number.isFinite(last) ? last : Number.POSITIVE_INFINITY;
}

interface SortReviewItemsOptions<T> {
  getStatus: (item: T) => ReviewItemStatus;
  getIndexHint?: (item: T) => number | string | null | undefined;
  getName?: (item: T) => string | null | undefined;
}

const normalizeIndex = (value: number | string | null | undefined): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    return extractSortIndex(value);
  }
  return Number.POSITIVE_INFINITY;
};

export function sortReviewItems<T>(items: T[], options: SortReviewItemsOptions<T>): T[] {
  const { getStatus, getIndexHint, getName } = options;
  return [...items].sort((a, b) => {
    const statusDelta = statusRank[getStatus(a)] - statusRank[getStatus(b)];
    if (statusDelta !== 0) return statusDelta;

    const indexA = normalizeIndex(getIndexHint?.(a));
    const indexB = normalizeIndex(getIndexHint?.(b));
    if (indexA !== indexB) return indexA - indexB;

    const nameA = (getName?.(a) ?? "").trim();
    const nameB = (getName?.(b) ?? "").trim();
    return nameA.localeCompare(nameB, "zh-CN");
  });
}
