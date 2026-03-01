import { useHeightCheckStore } from "@/features/height-check/store";
import { useSetbackCheckStore } from "@/features/setback-check/store";
import { useSightCorridorStore } from "@/features/sight-corridor/store";
import { useFireLadderStore } from "@/features/fire-ladder/store";
import { useSkyBridgeStore } from "@/features/sky-bridge/store";
import { useVehicleEntranceStore } from "@/features/vehicle-entrance-check/store";
import { usePedestrianEntranceStore } from "@/features/pedestrian-entrance-check/store";
import { useGreenSetbackStore } from "@/features/green-setback-check/store";
import { usePlazaSetbackStore } from "@/features/plaza-setback-check/store";
import { useSetbackRateCheckStore } from "@/features/setback-rate-check/store";

export const REVIEW_TOOL_IDS = [
  "height-check",
  "setback-check",
  "view-corridor-check",
  "fire-ladder-check",
  "sky-bridge-check",
  "vehicle-entrance-check",
  "pedestrian-entrance-check",
  "green-setback-check",
  "plaza-setback-check",
  "setback-rate-check",
] as const;

export type ReviewToolId = typeof REVIEW_TOOL_IDS[number];

const REVIEW_TOOL_ID_SET = new Set<string>(REVIEW_TOOL_IDS);
const REVIEW_TOOL_ALIASES: Record<string, ReviewToolId> = {
  "sight-corridor": "view-corridor-check",
};

export function normalizeReviewToolId(toolId: string): ReviewToolId | null {
  const normalized = REVIEW_TOOL_ALIASES[toolId] ?? toolId;
  if (!REVIEW_TOOL_ID_SET.has(normalized)) {
    return null;
  }
  return normalized as ReviewToolId;
}

export function hideAllReviewToolVisuals() {
  useHeightCheckStore.getState().setShowSetbackVolumes(false);
  useHeightCheckStore.getState().setShowHeightCheckLabels(false);
  useSetbackCheckStore.getState().setShowHighlights(false);
  useSightCorridorStore.getState().setShowCorridorLayer(false);
  useSightCorridorStore.getState().setShowBlockingLabels(false);
  useFireLadderStore.getState().setShowLabels(false);
  useSkyBridgeStore.getState().setShowLabels(false);
  useVehicleEntranceStore.getState().setShowHighlights(false);
  usePedestrianEntranceStore.getState().setShowHighlights(false);
  useGreenSetbackStore.getState().setShowHighlights(false);
  usePlazaSetbackStore.getState().setShowHighlights(false);
  useSetbackRateCheckStore.getState().setShowSetbackLabels(false);
}

export function showOnlyReviewToolVisuals(toolId: string) {
  const normalizedToolId = normalizeReviewToolId(toolId);
  hideAllReviewToolVisuals();
  if (!normalizedToolId) {
    return;
  }

  switch (normalizedToolId) {
    case "height-check":
      useHeightCheckStore.getState().setShowSetbackVolumes(true);
      useHeightCheckStore.getState().setShowHeightCheckLabels(true);
      break;
    case "setback-check":
      useSetbackCheckStore.getState().setShowHighlights(true);
      break;
    case "view-corridor-check":
      useSightCorridorStore.getState().setShowCorridorLayer(true);
      useSightCorridorStore.getState().setShowBlockingLabels(true);
      break;
    case "fire-ladder-check":
      useFireLadderStore.getState().setShowLabels(true);
      break;
    case "sky-bridge-check":
      useSkyBridgeStore.getState().setShowLabels(true);
      break;
    case "vehicle-entrance-check":
      useVehicleEntranceStore.getState().setShowHighlights(true);
      break;
    case "pedestrian-entrance-check":
      usePedestrianEntranceStore.getState().setShowHighlights(true);
      break;
    case "green-setback-check":
      useGreenSetbackStore.getState().setShowHighlights(true);
      break;
    case "plaza-setback-check":
      usePlazaSetbackStore.getState().setShowHighlights(true);
      break;
    case "setback-rate-check":
      useSetbackRateCheckStore.getState().setShowSetbackLabels(true);
      break;
  }
}
