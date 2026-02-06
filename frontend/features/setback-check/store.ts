import { create } from "zustand";
import type { SetbackCheckResult } from "@/lib/setback-check-types";

type HighlightTarget = { type: "overall" | "plot" | null; plotName?: string | null };

interface SetbackCheckState {
  result: SetbackCheckResult | null;
  highlightTarget: HighlightTarget;
  showSetbackLabels: boolean;
  selectedPlotName: string | null;
  setResult: (result: SetbackCheckResult | null) => void;
  setHighlightTarget: (target: HighlightTarget) => void;
  setShowSetbackLabels: (show: boolean) => void;
  setSelectedPlotName: (plotName: string | null) => void;
  reset: () => void;
}

const initialState = {
  result: null as SetbackCheckResult | null,
  highlightTarget: { type: null } as HighlightTarget,
  showSetbackLabels: true,
  selectedPlotName: null as string | null,
};

export const useSetbackCheckStore = create<SetbackCheckState>((set) => ({
  ...initialState,
  setResult: (result) => set({ result }),
  setHighlightTarget: (target) => set({ highlightTarget: target }),
  setShowSetbackLabels: (show) => set({ showSetbackLabels: show }),
  setSelectedPlotName: (plotName) => set({ selectedPlotName: plotName }),
  reset: () =>
    set({
      ...initialState,
      showSetbackLabels: false,
    }),
}));
