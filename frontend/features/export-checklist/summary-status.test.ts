import assert from "node:assert/strict";
import test from "node:test";
import { getSummaryTextClass } from "./summary-status";

test("returns green when item is marked pass even if summary lacks pass keywords", () => {
  assert.equal(getSummaryTextClass("通廊畅通", true), "text-green-600");
});

test("returns gray for 未检测 summaries", () => {
  assert.equal(getSummaryTextClass("未检测", false), "text-gray-400");
  assert.equal(getSummaryTextClass("未检测", true), "text-gray-400");
});

test("returns red when item fails", () => {
  assert.equal(getSummaryTextClass("15 项不合格", false), "text-red-600");
});

test("keeps keyword fallback for old data without pass flag", () => {
  assert.equal(getSummaryTextClass("3 栋通过", undefined), "text-green-600");
  assert.equal(getSummaryTextClass("1 项不通过", undefined), "text-red-600");
});
