"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveToolRunStatus = deriveToolRunStatus;
exports.resolveChecklistFeatureStatus = resolveChecklistFeatureStatus;
exports.resolveToolRunStatusMark = resolveToolRunStatusMark;
exports.resolveVisibleToolIds = resolveVisibleToolIds;
exports.filterToolsByView = filterToolsByView;
exports.resolveAutoRevealToolId = resolveAutoRevealToolId;
function deriveToolRunStatus(hasResult, hasFailure) {
    if (!hasResult)
        return "idle";
    return hasFailure ? "fail" : "pass";
}
function resolveChecklistFeatureStatus(checked, isPass) {
    if (!checked)
        return "idle";
    return isPass ? "pass" : "fail";
}
function resolveToolRunStatusMark(status) {
    if (status === "pass")
        return "√";
    if (status === "fail")
        return "×";
    return " ";
}
function resolveVisibleToolIds(activeView, toolIds) {
    if (activeView === "approval-checklist") {
        return toolIds;
    }
    return toolIds.includes(activeView) ? [activeView] : [];
}
function filterToolsByView(tools, activeView) {
    const visibleIds = new Set(resolveVisibleToolIds(activeView, tools.map((tool) => tool.id)));
    return tools.filter((tool) => visibleIds.has(tool.id));
}
function resolveAutoRevealToolId(activeView, toolIds, toolStatusMap) {
    if (!toolIds.includes(activeView)) {
        return null;
    }
    const activeStatus = toolStatusMap[activeView] ?? "idle";
    return activeStatus === "idle" ? null : activeView;
}
