import { create } from "zustand";
import type { SetbackViolationResult } from "./types";

interface SetbackCheckState {
  result: SetbackViolationResult | null;
  showHighlights: boolean;
  selectedBuildingIndex: number | null;
  setResult: (result: SetbackViolationResult | null) => void;
  setShowHighlights: (show: boolean) => void;
  setSelectedBuildingIndex: (index: number | null) => void;
  reset: () => void;
}

const initialState = {
  result: null as SetbackViolationResult | null,
  showHighlights: true,
  selectedBuildingIndex: null as number | null,
};

export const useSetbackCheckStore = create<SetbackCheckState>((set) => ({
  ...initialState,
  setResult: (result) => set({ result, selectedBuildingIndex: null }),
  setShowHighlights: (show) => set({ showHighlights: show }),
  setSelectedBuildingIndex: (index) => set({ selectedBuildingIndex: index }),
  reset: () =>
    set({
      ...initialState,
      showHighlights: false,
    }),
}));
