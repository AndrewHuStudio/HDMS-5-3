/** 人行出入口检测 Zustand store - 管理检测结果和高亮开关 */
import { create } from "zustand";
import type { PedestrianEntranceCheckResponse } from "./types";

interface PedestrianEntranceState {
  result: PedestrianEntranceCheckResponse | null;
  showHighlights: boolean;
  selectedRedlineKey: string | null;
  setResult: (result: PedestrianEntranceCheckResponse | null) => void;
  setShowHighlights: (show: boolean) => void;
  setSelectedRedlineKey: (key: string | null) => void;
  reset: () => void;
}

const initialState = {
  result: null as PedestrianEntranceCheckResponse | null,
  showHighlights: true,
  selectedRedlineKey: null as string | null,
};

export const usePedestrianEntranceStore = create<PedestrianEntranceState>((set) => ({
  ...initialState,
  setResult: (result) => set({ result, selectedRedlineKey: null }),
  setShowHighlights: (show) => set({ showHighlights: show }),
  setSelectedRedlineKey: (key) => set({ selectedRedlineKey: key }),
  reset: () =>
    set({
      ...initialState,
      showHighlights: false,
    }),
}));
