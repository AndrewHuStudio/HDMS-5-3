// 一键校验状态管理

import { create } from "zustand";
import type { VerificationReport, VerificationStatus } from "./types";

interface VerificationStore {
  report: VerificationReport | null;
  setReport: (report: VerificationReport | null) => void;

  status: VerificationStatus;
  setStatus: (status: VerificationStatus) => void;

  error: string | null;
  setError: (error: string | null) => void;

  startTime: number | null;
  setStartTime: (t: number | null) => void;

  reset: () => void;
}

export const useVerificationStore = create<VerificationStore>((set) => ({
  report: null,
  setReport: (report) => set({ report }),

  status: "idle",
  setStatus: (status) => set({ status }),

  error: null,
  setError: (error) => set({ error }),

  startTime: null,
  setStartTime: (t) => set({ startTime: t }),

  reset: () =>
    set({
      report: null,
      status: "idle",
      error: null,
      startTime: null,
    }),
}));
