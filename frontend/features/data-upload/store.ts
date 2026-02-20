// OCR 状态管理

import { create } from "zustand";
import type { OCRJob, OCRSummary, OCRStatus } from "./types";

interface OCRStore {
  currentJob: OCRJob | null;
  setCurrentJob: (job: OCRJob | null) => void;

  status: OCRStatus;
  setStatus: (status: OCRStatus) => void;

  error: string | null;
  setError: (error: string | null) => void;

  summary: OCRSummary | null;
  setSummary: (summary: OCRSummary | null) => void;

  outputRoot: string | null;
  setOutputRoot: (root: string | null) => void;

  destinations: string[];
  setDestinations: (destinations: string[]) => void;

  selectedDestination: string;
  setSelectedDestination: (destination: string) => void;

  // 计时
  startTime: number | null;
  setStartTime: (t: number | null) => void;

  reset: () => void;
}

export const useOCRStore = create<OCRStore>((set) => ({
  currentJob: null,
  setCurrentJob: (job) => set({ currentJob: job }),

  status: "idle",
  setStatus: (status) => set({ status }),

  error: null,
  setError: (error) => set({ error }),

  summary: null,
  setSummary: (summary) => set({ summary }),

  outputRoot: null,
  setOutputRoot: (root) => set({ outputRoot: root }),

  destinations: [],
  setDestinations: (destinations) => set({ destinations }),

  selectedDestination: "",
  setSelectedDestination: (destination) => set({ selectedDestination: destination }),

  startTime: null,
  setStartTime: (t) => set({ startTime: t }),

  reset: () =>
    set({
      currentJob: null,
      status: "idle",
      error: null,
      startTime: null,
    }),
}));
