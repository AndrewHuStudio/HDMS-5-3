import { create } from "zustand";
import type { HeightCheckSetbackVolume, BuildingResult } from "./types";

interface HeightCheckState {
  results: BuildingResult[];
  warnings: string[];
  volumes: HeightCheckSetbackVolume[];
  showSetbackVolumes: boolean;
  showHeightCheckLabels: boolean;
  selectedBuildingIndex: number | null;
  setResults: (results: BuildingResult[]) => void;
  setWarnings: (warnings: string[]) => void;
  setVolumes: (volumes: HeightCheckSetbackVolume[]) => void;
  setShowSetbackVolumes: (show: boolean) => void;
  setShowHeightCheckLabels: (show: boolean) => void;
  setSelectedBuildingIndex: (index: number | null) => void;
  reset: () => void;
}

const initialState = {
  results: [] as BuildingResult[],
  warnings: [] as string[],
  volumes: [] as HeightCheckSetbackVolume[],
  showSetbackVolumes: true,
  showHeightCheckLabels: true,
  selectedBuildingIndex: null as number | null,
};

export const useHeightCheckStore = create<HeightCheckState>((set) => ({
  ...initialState,
  setResults: (results) => set({ results, selectedBuildingIndex: null }),
  setWarnings: (warnings) => set({ warnings }),
  setVolumes: (volumes) => set({ volumes }),
  setShowSetbackVolumes: (show) => set({ showSetbackVolumes: show }),
  setShowHeightCheckLabels: (show) => set({ showHeightCheckLabels: show }),
  setSelectedBuildingIndex: (index) => set({ selectedBuildingIndex: index }),
  reset: () =>
    set({
      ...initialState,
      showSetbackVolumes: false,
      showHeightCheckLabels: false,
    }),
}));
