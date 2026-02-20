// 向量化处理状态管理

import { create } from "zustand";
import type {
  IngestionDocState,
  IngestionReportResponse,
  IngestionStatus,
  VectorStatus,
} from "./types";

interface VectorStore {
  // 从 OCR 结果中选中的文档（markdown_path 列表）
  selectedDocs: string[];
  setSelectedDocs: (docs: string[]) => void;
  toggleDoc: (markdownPath: string) => void;
  selectAll: (paths: string[]) => void;
  clearSelection: () => void;

  // 入库报告
  report: IngestionReportResponse | null;
  setReport: (report: IngestionReportResponse | null) => void;

  // 系统状态
  sysStatus: IngestionStatus | null;
  setSysStatus: (status: IngestionStatus | null) => void;

  // 流程状态
  status: VectorStatus;
  setStatus: (status: VectorStatus) => void;

  error: string | null;
  setError: (error: string | null) => void;

  // 计时
  startTime: number | null;
  setStartTime: (t: number | null) => void;

  reset: () => void;
}

export const useVectorStore = create<VectorStore>((set) => ({
  selectedDocs: [],
  setSelectedDocs: (docs) => set({ selectedDocs: docs }),
  toggleDoc: (markdownPath) =>
    set((state) => ({
      selectedDocs: state.selectedDocs.includes(markdownPath)
        ? state.selectedDocs.filter((p) => p !== markdownPath)
        : [...state.selectedDocs, markdownPath],
    })),
  selectAll: (paths) => set({ selectedDocs: paths }),
  clearSelection: () => set({ selectedDocs: [] }),

  report: null,
  setReport: (report) => set({ report }),

  sysStatus: null,
  setSysStatus: (status) => set({ sysStatus: status }),

  status: "idle",
  setStatus: (status) => set({ status }),

  error: null,
  setError: (error) => set({ error }),

  startTime: null,
  setStartTime: (t) => set({ startTime: t }),

  reset: () =>
    set({
      selectedDocs: [],
      report: null,
      status: "idle",
      error: null,
      startTime: null,
    }),
}));
