import assert from "node:assert/strict";
import test from "node:test";
import { getPedestrianEntranceViolationCount } from "./approval-checklist-status";

test("uses redline summary failures for pedestrian entrance violations", () => {
  const result = {
    summary: { failed: 4 },
    redlines: [
      { status: "fail" as const },
      { status: "fail" as const },
      { status: "fail" as const },
      { status: "fail" as const },
    ],
    results: [{ status: "pass" as const }],
  };

  assert.equal(getPedestrianEntranceViolationCount(result), 4);
});

test("falls back to result-level failure count when summary is unavailable", () => {
  const result = {
    redlines: [] as Array<{ status: "pass" | "fail" }>,
    results: [{ status: "fail" as const }, { status: "pass" as const }, { status: "fail" as const }],
  };

  assert.equal(getPedestrianEntranceViolationCount(result), 2);
});
