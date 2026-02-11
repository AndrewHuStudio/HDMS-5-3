import { create } from "zustand";
import type { SkyBridgeResult } from "./types";

interface SkyBridgeState {
  results: SkyBridgeResult[];
  warnings: string[];
  showLabels: boolean;
  setResults: (results: SkyBridgeResult[]) => void;
  setWarnings: (warnings: string[]) => void;
  setShowLabels: (show: boolean) => void;
  reset: () => void;
}

const initialState = {
  results: [] as SkyBridgeResult[],
  warnings: [] as string[],
  showLabels: true,
};

export const useSkyBridgeStore = create<SkyBridgeState>((set) => ({
  ...initialState,
  setResults: (results) => set({ results }),
  setWarnings: (warnings) => set({ warnings }),
  setShowLabels: (show) => set({ showLabels: show }),
  reset: () => set({ ...initialState, showLabels: false }),
}));
