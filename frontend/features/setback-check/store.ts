import { create } from "zustand";
import type { SetbackViolationResult } from "./types";

interface SetbackCheckState {
  result: SetbackViolationResult | null;
  showHighlights: boolean;
  setResult: (result: SetbackViolationResult | null) => void;
  setShowHighlights: (show: boolean) => void;
  reset: () => void;
}

const initialState = {
  result: null as SetbackViolationResult | null,
  showHighlights: true,
};

export const useSetbackCheckStore = create<SetbackCheckState>((set) => ({
  ...initialState,
  setResult: (result) => set({ result }),
  setShowHighlights: (show) => set({ showHighlights: show }),
  reset: () =>
    set({
      ...initialState,
      showHighlights: false,
    }),
}));
