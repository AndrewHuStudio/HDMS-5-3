import { create } from "zustand";
import type { VehicleEntranceCheckResponse } from "./types";

interface VehicleEntranceState {
  result: VehicleEntranceCheckResponse | null;
  showHighlights: boolean;
  selectedEntranceId: string | null;
  setResult: (result: VehicleEntranceCheckResponse | null) => void;
  setShowHighlights: (show: boolean) => void;
  setSelectedEntranceId: (id: string | null) => void;
  reset: () => void;
}

const initialState = {
  result: null as VehicleEntranceCheckResponse | null,
  showHighlights: true,
  selectedEntranceId: null as string | null,
};

export const useVehicleEntranceStore = create<VehicleEntranceState>((set) => ({
  ...initialState,
  setResult: (result) => set({ result, selectedEntranceId: null }),
  setShowHighlights: (show) => set({ showHighlights: show }),
  setSelectedEntranceId: (id) => set({ selectedEntranceId: id }),
  reset: () =>
    set({
      ...initialState,
      showHighlights: false,
    }),
}));
