import { create } from "zustand";
import type { CorridorCollisionResult } from "./types";

interface SightCorridorState {
  collisionResult: CorridorCollisionResult | null;
  showCorridorLayer: boolean;
  showBlockingLabels: boolean;
  selectedBlockedBuildingName: string | null;
  setCollisionResult: (result: CorridorCollisionResult | null) => void;
  setShowCorridorLayer: (show: boolean) => void;
  setShowBlockingLabels: (show: boolean) => void;
  setSelectedBlockedBuildingName: (name: string | null) => void;
  reset: () => void;
}

const initialState = {
  collisionResult: null as CorridorCollisionResult | null,
  showCorridorLayer: false,
  showBlockingLabels: true,
  selectedBlockedBuildingName: null as string | null,
};

export const useSightCorridorStore = create<SightCorridorState>((set) => ({
  ...initialState,
  setCollisionResult: (result) => set({ collisionResult: result, selectedBlockedBuildingName: null }),
  setShowCorridorLayer: (show) => set({ showCorridorLayer: show }),
  setShowBlockingLabels: (show) => set({ showBlockingLabels: show }),
  setSelectedBlockedBuildingName: (name) => set({ selectedBlockedBuildingName: name }),
  reset: () =>
    set({
      ...initialState,
      showBlockingLabels: false,
    }),
}));
