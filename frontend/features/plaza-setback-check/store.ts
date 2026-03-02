/** 广场退线检测 Zustand store - 管理检测结果、高亮开关和选中区域 */
import { create } from "zustand";
import type { PlazaSetbackCheckResponse } from "./types";

interface PlazaSetbackState {
  result: PlazaSetbackCheckResponse | null;
  showHighlights: boolean;
  selectedAreaId: string | null;
  setResult: (result: PlazaSetbackCheckResponse | null) => void;
  setShowHighlights: (show: boolean) => void;
  setSelectedAreaId: (id: string | null) => void;
  reset: () => void;
}

const initialState = {
  result: null as PlazaSetbackCheckResponse | null,
  showHighlights: true,
  selectedAreaId: null as string | null,
};

export const usePlazaSetbackStore = create<PlazaSetbackState>((set) => ({
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
