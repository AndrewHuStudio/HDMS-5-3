import { create } from "zustand";
import type { HeightCheckSetbackVolume } from "@/lib/height-check-types";
import type { BuildingResult } from "@/components/height-check-panel-pure";

interface HeightCheckState {
  results: BuildingResult[];
  warnings: string[];
  volumes: HeightCheckSetbackVolume[];
  showSetbackVolumes: boolean;
  showHeightCheckLabels: boolean;
  setResults: (results: BuildingResult[]) => void;
  setWarnings: (warnings: string[]) => void;
  setVolumes: (volumes: HeightCheckSetbackVolume[]) => void;
  setShowSetbackVolumes: (show: boolean) => void;
  setShowHeightCheckLabels: (show: boolean) => void;
  reset: () => void;
}

const initialState = {
  results: [] as BuildingResult[],
  warnings: [] as string[],
  volumes: [] as HeightCheckSetbackVolume[],
  showSetbackVolumes: true,
  showHeightCheckLabels: true,
};

export const useHeightCheckStore = create<HeightCheckState>((set) => ({
  ...initialState,
  setResults: (results) => set({ results }),
  setWarnings: (warnings) => set({ warnings }),
  setVolumes: (volumes) => set({ volumes }),
  setShowSetbackVolumes: (show) => set({ showSetbackVolumes: show }),
  setShowHeightCheckLabels: (show) => set({ showHeightCheckLabels: show }),
  reset: () =>
    set({
      ...initialState,
      showSetbackVolumes: false,
      showHeightCheckLabels: false,
    }),
}));
