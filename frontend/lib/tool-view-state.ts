export type ToolRunStatus = "idle" | "pass" | "fail";

export function deriveToolRunStatus(hasResult: boolean, hasFailure: boolean): ToolRunStatus {
  if (!hasResult) return "idle";
  return hasFailure ? "fail" : "pass";
}

export function resolveChecklistFeatureStatus(checked: boolean, isPass: boolean): ToolRunStatus {
  if (!checked) return "idle";
  return isPass ? "pass" : "fail";
}

export function resolveToolRunStatusMark(status: ToolRunStatus): "√" | "×" | " " {
  if (status === "pass") return "√";
  if (status === "fail") return "×";
  return " ";
}

export function resolveVisibleToolIds(activeView: string, toolIds: string[]): string[] {
  if (activeView === "approval-checklist") {
    return toolIds;
  }
  return toolIds.includes(activeView) ? [activeView] : [];
}

export function filterToolsByView<T extends { id: string }>(tools: T[], activeView: string): T[] {
  const visibleIds = new Set(resolveVisibleToolIds(activeView, tools.map((tool) => tool.id)));
  return tools.filter((tool) => visibleIds.has(tool.id));
}

export function resolveAutoRevealToolId(
  activeView: string,
  toolIds: string[],
  toolStatusMap: Partial<Record<string, ToolRunStatus>>
): string | null {
  if (!toolIds.includes(activeView)) {
    return null;
  }

  const activeStatus = toolStatusMap[activeView] ?? "idle";
  return activeStatus === "idle" ? null : activeView;
}
