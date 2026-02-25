import { create } from "zustand";
import type { GreenSetbackCheckResponse } from "./types";

interface GreenSetbackState {
  result: GreenSetbackCheckResponse | null;
  showHighlights: boolean;
  selectedAreaName: string | null;
  setResult: (result: GreenSetbackCheckResponse | null) => void;
  setShowHighlights: (show: boolean) => void;
  setSelectedAreaName: (name: string | null) => void;
  reset: () => void;
}

const initialState = {
  result: null as GreenSetbackCheckResponse | null,
  showHighlights: true,
  selectedAreaName: null as string | null,
};

export const useGreenSetbackStore = create<GreenSetbackState>((set) => ({
  ...initialState,
  setResult: (result) => set({ result, selectedAreaName: null }),
  setShowHighlights: (show) => set({ showHighlights: show }),
  setSelectedAreaName: (name) => set({ selectedAreaName: name }),
  reset: () =>
    set({
      ...initialState,
      showHighlights: false,
    }),
}));
