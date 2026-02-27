import { create } from "zustand";
import type { CorridorCollisionResult } from "./types";

interface SightCorridorState {
  collisionResult: CorridorCollisionResult | null;
  showCorridorLayer: boolean;
  showBlockingLabels: boolean;
  setCollisionResult: (result: CorridorCollisionResult | null) => void;
  setShowCorridorLayer: (show: boolean) => void;
  setShowBlockingLabels: (show: boolean) => void;
  reset: () => void;
}

const initialState = {
  collisionResult: null as CorridorCollisionResult | null,
  showCorridorLayer: false,
  showBlockingLabels: true,
};

export const useSightCorridorStore = create<SightCorridorState>((set) => ({
  ...initialState,
  setCollisionResult: (result) => set({ collisionResult: result }),
  setShowCorridorLayer: (show) => set({ showCorridorLayer: show }),
  setShowBlockingLabels: (show) => set({ showBlockingLabels: show }),
  reset: () =>
    set({
      ...initialState,
      showBlockingLabels: false,
    }),
}));
