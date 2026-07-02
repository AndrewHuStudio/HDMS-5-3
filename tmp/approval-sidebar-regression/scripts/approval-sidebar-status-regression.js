"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const review_tool_links_1 = require("../lib/review-tool-links");
const toolStatusMap = {
    "height-check": "pass",
    "view-corridor-check": "fail",
    "fire-ladder-check": "pass",
    "sky-bridge-check": "fail",
};
strict_1.default.equal((0, review_tool_links_1.resolveReviewToolId)("height-check"), "height-check");
strict_1.default.equal((0, review_tool_links_1.resolveReviewToolId)("sight-corridor"), "view-corridor-check");
strict_1.default.equal((0, review_tool_links_1.resolveReviewToolId)("fire-ladder"), "fire-ladder-check");
strict_1.default.equal((0, review_tool_links_1.resolveReviewToolId)("sky-bridge"), "sky-bridge-check");
strict_1.default.deepEqual((0, review_tool_links_1.resolveReviewSidebarToolStatusMap)("/reviews", { ...toolStatusMap }), toolStatusMap);
strict_1.default.deepEqual((0, review_tool_links_1.resolveReviewSidebarToolStatusMap)("/approvals", { ...toolStatusMap }), toolStatusMap);
console.log("approval-sidebar-status-regression passed");
