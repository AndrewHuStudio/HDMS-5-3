import { create } from "zustand";
import type { SightCorridorPosition, SightCorridorResult, CorridorCollisionResult } from "@/lib/sight-corridor-types";

interface SightCorridorState {
  position: SightCorridorPosition | null;
  radius: number;
  result: SightCorridorResult | null;
  collisionResult: CorridorCollisionResult | null;
  showCorridorLayer: boolean;
  showLabels: boolean;
  showBlockingLabels: boolean;
  setPosition: (position: SightCorridorPosition | null) => void;
  setRadius: (radius: number) => void;
  setResult: (result: SightCorridorResult | null) => void;
  setCollisionResult: (result: CorridorCollisionResult | null) => void;
  setShowCorridorLayer: (show: boolean) => void;
  setShowLabels: (show: boolean) => void;
  setShowBlockingLabels: (show: boolean) => void;
  reset: () => void;
}

const initialState = {
  position: null as SightCorridorPosition | null,
  radius: 100,
  result: null as SightCorridorResult | null,
  collisionResult: null as CorridorCollisionResult | null,
  showCorridorLayer: false,
  showLabels: true,
  showBlockingLabels: true,
};

export const useSightCorridorStore = create<SightCorridorState>((set) => ({
  ...initialState,
  setPosition: (position) => set({ position }),
  setRadius: (radius) => set({ radius }),
  setResult: (result) => set({ result }),
  setCollisionResult: (result) => set({ collisionResult: result }),
  setShowCorridorLayer: (show) => set({ showCorridorLayer: show }),
  setShowLabels: (show) => set({ showLabels: show }),
  setShowBlockingLabels: (show) => set({ showBlockingLabels: show }),
  reset: () =>
    set({
      ...initialState,
      showLabels: false,
      showBlockingLabels: false,
    }),
}));
