// 图谱化处理状态管理

import { create } from "zustand";
import type {
  BatchGraphBuildResponse,
  GraphStatistics,
  GraphStatus,
} from "./types";

interface GraphStore {
  // 构建结果
  buildResult: BatchGraphBuildResponse | null;
  setBuildResult: (result: BatchGraphBuildResponse | null) => void;

  // 图谱统计
  statistics: GraphStatistics | null;
  setStatistics: (stats: GraphStatistics | null) => void;

  // 流程状态
  status: GraphStatus;
  setStatus: (status: GraphStatus) => void;

  error: string | null;
  setError: (error: string | null) => void;

  // 计时
  startTime: number | null;
  setStartTime: (t: number | null) => void;

  // 图谱弹窗
  showGraphDialog: boolean;
  setShowGraphDialog: (show: boolean) => void;

  reset: () => void;
}

export const useGraphStore = create<GraphStore>((set) => ({
  buildResult: null,
  setBuildResult: (result) => set({ buildResult: result }),

  statistics: null,
  setStatistics: (stats) => set({ statistics: stats }),

  status: "idle",
  setStatus: (status) => set({ status }),

  error: null,
  setError: (error) => set({ error }),

  startTime: null,
  setStartTime: (t) => set({ startTime: t }),

  showGraphDialog: false,
  setShowGraphDialog: (show) => set({ showGraphDialog: show }),

  reset: () =>
    set({
      buildResult: null,
      status: "idle",
      error: null,
      startTime: null,
    }),
}));
