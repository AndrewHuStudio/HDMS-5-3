import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveToolRunStatus,
  filterToolsByView,
  resolveChecklistFeatureStatus,
  resolveToolRunStatusMark,
  resolveAutoRevealToolId,
  resolveVisibleToolIds,
} from "./tool-view-state";

test("deriveToolRunStatus returns idle/pass/fail based on run and violation", () => {
  assert.equal(deriveToolRunStatus(false, false), "idle");
  assert.equal(deriveToolRunStatus(true, false), "pass");
  assert.equal(deriveToolRunStatus(true, true), "fail");
});

test("resolveVisibleToolIds only keeps active tool for tool views", () => {
  const toolIds = ["height-check", "setback-rate-check"];
  assert.deepEqual(resolveVisibleToolIds("height-check", toolIds), ["height-check"]);
});

test("resolveVisibleToolIds keeps all tools for approval checklist", () => {
  const toolIds = ["height-check", "setback-rate-check"];
  assert.deepEqual(resolveVisibleToolIds("approval-checklist", toolIds), toolIds);
});

test("resolveVisibleToolIds hides tool visuals on non-tool pages", () => {
  const toolIds = ["height-check", "setback-rate-check"];
  assert.deepEqual(resolveVisibleToolIds("qa-assistant", toolIds), []);
});

test("filterToolsByView filters the tool array using the same visibility rules", () => {
  const tools = [
    { id: "height-check", name: "限高" },
    { id: "setback-rate-check", name: "贴线率" },
  ];

  assert.deepEqual(filterToolsByView(tools, "setback-rate-check"), [tools[1]]);
  assert.deepEqual(filterToolsByView(tools, "approval-checklist"), tools);
  assert.deepEqual(filterToolsByView(tools, "qa-assistant"), []);
});

test("resolveAutoRevealToolId only returns active tool when it has check results", () => {
  const toolIds = ["height-check", "setback-rate-check"];
  const statuses: Record<string, "idle" | "pass" | "fail"> = {
    "height-check": "pass",
    "setback-rate-check": "idle",
  };

  assert.equal(resolveAutoRevealToolId("height-check", toolIds, statuses), "height-check");
  assert.equal(resolveAutoRevealToolId("setback-rate-check", toolIds, statuses), null);
  assert.equal(resolveAutoRevealToolId("approval-checklist", toolIds, statuses), null);
});

test("resolveChecklistFeatureStatus marks unchecked as idle and checked failures as fail", () => {
  assert.equal(resolveChecklistFeatureStatus(false, false), "idle");
  assert.equal(resolveChecklistFeatureStatus(true, true), "pass");
  assert.equal(resolveChecklistFeatureStatus(true, false), "fail");
});

test("resolveToolRunStatusMark uses cross symbol for failed status", () => {
  assert.equal(resolveToolRunStatusMark("pass"), "√");
  assert.equal(resolveToolRunStatusMark("fail"), "×");
  assert.equal(resolveToolRunStatusMark("idle"), " ");
});
