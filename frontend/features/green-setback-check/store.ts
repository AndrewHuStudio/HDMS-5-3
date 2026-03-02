/** 绿地退线检测 Zustand store - 管理检测结果、高亮开关和选中区域 */
import { create } from "zustand";
import type { GreenSetbackCheckResponse } from "./types";

interface GreenSetbackState {
  result: GreenSetbackCheckResponse | null;
  showHighlights: boolean;
  selectedAreaId: string | null;
  setResult: (result: GreenSetbackCheckResponse | null) => void;
  setShowHighlights: (show: boolean) => void;
  setSelectedAreaId: (id: string | null) => void;
  reset: () => void;
}

const initialState = {
  result: null as GreenSetbackCheckResponse | null,
  showHighlights: true,
  selectedAreaId: null as string | null,
};

export const useGreenSetbackStore = create<GreenSetbackState>((set) => ({
  ...initialState,
  setResult: (result) => set({ result, selectedAreaId: null }),
  setShowHighlights: (show) => set({ showHighlights: show }),
  setSelectedAreaId: (id) => set({ selectedAreaId: id }),
  reset: () =>
    set({
      ...initialState,
      showHighlights: false,
    }),
}));
