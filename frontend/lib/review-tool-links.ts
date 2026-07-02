import type { ToolRunStatus } from "./tool-view-state";

export type ReviewToolId =
  | "height-check"
  | "setback-check"
  | "view-corridor-check"
  | "fire-ladder-check"
  | "sky-bridge-check"
  | "vehicle-entrance-check"
  | "pedestrian-entrance-check"
  | "green-setback-check"
  | "plaza-setback-check"
  | "setback-rate-check";

export type ReviewToolLookupId =
  | ReviewToolId
  | "sight-corridor"
  | "fire-ladder"
  | "sky-bridge";

const REVIEW_TOOL_ID_ALIASES: Record<
  Exclude<ReviewToolLookupId, ReviewToolId>,
  ReviewToolId
> = {
  "sight-corridor": "view-corridor-check",
  "fire-ladder": "fire-ladder-check",
  "sky-bridge": "sky-bridge-check",
};

export function resolveReviewToolId(toolId: ReviewToolLookupId): ReviewToolId {
  switch (toolId) {
    case "sight-corridor":
    case "fire-ladder":
    case "sky-bridge":
      return REVIEW_TOOL_ID_ALIASES[toolId];
    default:
      return toolId;
  }
}

export function resolveReviewSidebarToolStatusMap(
  pathname: string,
  toolStatusMap: Record<string, ToolRunStatus>
): Record<string, ToolRunStatus> {
  return pathname === "/reviews" || pathname === "/approvals" ? toolStatusMap : {};
}
