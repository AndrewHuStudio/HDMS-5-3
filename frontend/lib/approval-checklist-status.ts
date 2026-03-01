type StatusLike = {
  status?: "pass" | "fail" | string;
};

type PedestrianStatusLike = {
  summary?: {
    failed?: number;
  } | null;
  redlines?: StatusLike[] | null;
  results?: StatusLike[] | null;
};

export function getPedestrianEntranceViolationCount(
  result?: Partial<PedestrianStatusLike> | null
): number {
  if (!result) return 0;

  const summaryFailed = result.summary?.failed;
  if (typeof summaryFailed === "number") {
    return summaryFailed;
  }

  const redlineViolations = result.redlines?.filter((item) => item.status === "fail").length;
  if (typeof redlineViolations === "number" && redlineViolations > 0) {
    return redlineViolations;
  }

  return result.results?.filter((item) => item.status === "fail").length ?? 0;
}
