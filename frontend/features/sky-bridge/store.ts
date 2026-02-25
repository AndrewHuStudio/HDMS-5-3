import { create } from "zustand";
import type { PlotInfo, SkyBridgeConnection, SkyBridgeResult } from "./types";

interface SkyBridgeState {
  plots: PlotInfo[];
  autoConnections: SkyBridgeConnection[];
  connections: SkyBridgeConnection[];
  selectedPlot: string | null;
  elevation: number;
  minWidth: number;
  minHeight: number;
  results: SkyBridgeResult[];
  warnings: string[];
  showLabels: boolean;
  setPlots: (plots: PlotInfo[]) => void;
  setAutoConnections: (connections: SkyBridgeConnection[]) => void;
  setConnections: (connections: SkyBridgeConnection[]) => void;
  toggleConnection: (from: string, to: string) => void;
  setSelectedPlot: (name: string | null) => void;
  setElevation: (value: number) => void;
  setMinWidth: (value: number) => void;
  setMinHeight: (value: number) => void;
  setResults: (results: SkyBridgeResult[]) => void;
  setWarnings: (warnings: string[]) => void;
  setShowLabels: (show: boolean) => void;
  reset: () => void;
}

const normalizePair = (a: string, b: string) => (a <= b ? [a, b] : [b, a]);

const normalizeConnections = (connections: SkyBridgeConnection[]) => {
  const seen = new Set<string>();
  const normalized: SkyBridgeConnection[] = [];
  connections.forEach((conn) => {
    const [from, to] = normalizePair(String(conn.from).trim(), String(conn.to).trim());
    if (!from || !to || from === to) return;
    const key = `${from}||${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({ from, to });
  });
  return normalized;
};

const initialState = {
  plots: [] as PlotInfo[],
  autoConnections: [] as SkyBridgeConnection[],
  connections: [] as SkyBridgeConnection[],
  selectedPlot: null as string | null,
  elevation: 7,
  minWidth: 6,
  minHeight: 4,
  results: [] as SkyBridgeResult[],
  warnings: [] as string[],
  showLabels: true,
};

export const useSkyBridgeStore = create<SkyBridgeState>((set, get) => ({
  ...initialState,
  setPlots: (plots) => set({ plots }),
  setAutoConnections: (connections) => set({ autoConnections: normalizeConnections(connections) }),
  setConnections: (connections) => set({ connections: normalizeConnections(connections) }),
  toggleConnection: (from, to) => {
    const [a, b] = normalizePair(String(from).trim(), String(to).trim());
    if (!a || !b || a === b) return;

    const existing = normalizeConnections(get().connections);
    const key = `${a}||${b}`;
    const next = existing.filter((item) => `${item.from}||${item.to}` !== key);
    if (next.length === existing.length) {
      next.push({ from: a, to: b });
    }
    set({ connections: next });
  },
  setSelectedPlot: (name) => set({ selectedPlot: name }),
  setElevation: (value) => set({ elevation: value }),
  setMinWidth: (value) => set({ minWidth: value }),
  setMinHeight: (value) => set({ minHeight: value }),
  setResults: (results) => set({ results }),
  setWarnings: (warnings) => set({ warnings }),
  setShowLabels: (show) => set({ showLabels: show }),
  reset: () => set({ ...initialState, showLabels: false }),
}));
