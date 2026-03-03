import { create } from "zustand";
import type { FeatureChecklistItem, ChecklistExportState, DetailedStatistics } from "./types";

interface ExportChecklistStore extends ChecklistExportState {
  setProjectName: (name: string) => void;
  setItems: (items: FeatureChecklistItem[]) => void;
  updateItem: (id: string, updates: Partial<FeatureChecklistItem>) => void;
  updateItemStats: (id: string, stats: DetailedStatistics) => void;
  setIsGeneratingAI: (isGenerating: boolean) => void;
  reset: () => void;
}

const initialState: ChecklistExportState = {
  projectName: "",
  items: [],
  isGeneratingAI: false,
};

export const useExportChecklistStore = create<ExportChecklistStore>((set) => ({
  ...initialState,
  setProjectName: (name) => set({ projectName: name }),
  setItems: (items) => set({ items }),
  updateItem: (id, updates) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      ),
    })),
  updateItemStats: (id, stats) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, detailedStats: stats } : item
      ),
    })),
  setIsGeneratingAI: (isGenerating) => set({ isGeneratingAI: isGenerating }),
  reset: () => set(initialState),
}));
