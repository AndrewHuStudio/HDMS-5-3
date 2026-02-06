import { create } from "zustand";
import type { FireLadderResult } from "./types";

interface FireLadderState {
  results: FireLadderResult[];
  warnings: string[];
  showLabels: boolean;
  setResults: (results: FireLadderResult[]) => void;
  setWarnings: (warnings: string[]) => void;
  setShowLabels: (show: boolean) => void;
  reset: () => void;
}

const initialState = {
  results: [] as FireLadderResult[],
  warnings: [] as string[],
  showLabels: true,
};

export const useFireLadderStore = create<FireLadderState>((set) => ({
  ...initialState,
  setResults: (results) => set({ results }),
  setWarnings: (warnings) => set({ warnings }),
  setShowLabels: (show) => set({ showLabels: show }),
  reset: () => set({ ...initialState, showLabels: false }),
}));
