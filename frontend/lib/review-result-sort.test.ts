import assert from "node:assert/strict";
import test from "node:test";
import { extractSortIndex, sortReviewItems } from "./review-result-sort";

test("extractSortIndex reads numeric suffix from codes like M-07", () => {
  assert.equal(extractSortIndex("M-07"), 7);
  assert.equal(extractSortIndex("地块17"), 17);
  assert.equal(extractSortIndex("无编号"), Number.POSITIVE_INFINITY);
});

test("sortReviewItems orders pass first then fail, and sorts by index asc", () => {
  const input = [
    { name: "N-10", status: "fail" as const },
    { name: "N-02", status: "pass" as const },
    { name: "N-01", status: "pass" as const },
    { name: "N-03", status: "fail" as const },
  ];

  const sorted = sortReviewItems(input, {
    getStatus: (item) => item.status,
    getIndexHint: (item) => item.name,
    getName: (item) => item.name,
  });

  assert.deepEqual(sorted.map((item) => item.name), ["N-01", "N-02", "N-03", "N-10"]);
});
