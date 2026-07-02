"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveReviewToolId = resolveReviewToolId;
exports.resolveReviewSidebarToolStatusMap = resolveReviewSidebarToolStatusMap;
const REVIEW_TOOL_ID_ALIASES = {
    "sight-corridor": "view-corridor-check",
    "fire-ladder": "fire-ladder-check",
    "sky-bridge": "sky-bridge-check",
};
function resolveReviewToolId(toolId) {
    return REVIEW_TOOL_ID_ALIASES[toolId] ?? toolId;
}
function resolveReviewSidebarToolStatusMap(pathname, toolStatusMap) {
    return pathname === "/reviews" || pathname === "/approvals" ? toolStatusMap : {};
}
