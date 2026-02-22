import { create } from "zustand";
import type { PlazaSetbackCheckResponse } from "./types";

interface PlazaSetbackState {
  result: PlazaSetbackCheckResponse | null;
  showHighlights: boolean;
  selectedAreaName: string | null;
  setResult: (result: PlazaSetbackCheckResponse | null) => void;
  setShowHighlights: (show: boolean) => void;
  setSelectedAreaName: (name: string | null) => void;
  reset: () => void;
}

const initialState = {
  result: null as PlazaSetbackCheckResponse | null,
  showHighlights: true,
  selectedAreaName: null as string | null,
};

export const usePlazaSetbackStore = create<PlazaSetbackState>((set) => ({
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
