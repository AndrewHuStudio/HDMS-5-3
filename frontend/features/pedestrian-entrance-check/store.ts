/** 人行出入口检测 Zustand store - 管理检测结果和高亮开关 */
import { create } from "zustand";
import type { PedestrianEntranceCheckResponse } from "./types";

interface PedestrianEntranceState {
  result: PedestrianEntranceCheckResponse | null;
  showHighlights: boolean;
  setResult: (result: PedestrianEntranceCheckResponse | null) => void;
  setShowHighlights: (show: boolean) => void;
  reset: () => void;
}

const initialState = {
  result: null as PedestrianEntranceCheckResponse | null,
  showHighlights: true,
};

export const usePedestrianEntranceStore = create<PedestrianEntranceState>((set) => ({
  ...initialState,
  setResult: (result) => set({ result }),
  setShowHighlights: (show) => set({ showHighlights: show }),
  reset: () =>
    set({
      ...initialState,
      showHighlights: false,
    }),
}));
