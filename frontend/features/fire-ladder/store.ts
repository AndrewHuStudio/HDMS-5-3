import { create } from "zustand";
import type { FireLadderResult } from "./types";

interface FireLadderState {
  results: FireLadderResult[];
  warnings: string[];
  showLabels: boolean;
  selectedRedlineIndex: number | null;
  setResults: (results: FireLadderResult[]) => void;
  setWarnings: (warnings: string[]) => void;
  setShowLabels: (show: boolean) => void;
  setSelectedRedlineIndex: (index: number | null) => void;
  reset: () => void;
}

const initialState = {
  results: [] as FireLadderResult[],
  warnings: [] as string[],
  showLabels: true,
  selectedRedlineIndex: null as number | null,
};

export const useFireLadderStore = create<FireLadderState>((set) => ({
  ...initialState,
  setResults: (results) => set({ results, selectedRedlineIndex: null }),
  setWarnings: (warnings) => set({ warnings }),
  setShowLabels: (show) => set({ showLabels: show }),
  setSelectedRedlineIndex: (index) => set({ selectedRedlineIndex: index }),
  reset: () => set({ ...initialState, showLabels: false }),
}));
