import { create } from "zustand";
import type { ModelFileType, ModelTransformSnapshot } from "@/components/city-scene";
import type { LayerInfo } from "@/components/model-uploader";
import type { PlanViewBuilding } from "@/lib/sight-corridor-types";

export type ModelBounds =
  | {
      min: [number, number, number];
      max: [number, number, number];
    }
  | undefined;

interface ModelState {
  externalModelUrl: string | null;
  externalModelType: ModelFileType | null;
  externalModelName: string | null;
  externalModelFile: File | null;
  modelFilePath: string | null;
  modelLayers: LayerInfo[];
  modelBounds: ModelBounds;
  modelScale: number;
  modelTransform: ModelTransformSnapshot | null;
  modelBuildings: PlanViewBuilding[];
  modelError: string | null;
  setExternalModel: (data: {
    url: string | null;
    type: ModelFileType | null;
    name?: string | null;
    file?: File | null;
  }) => void;
  setModelFilePath: (path: string | null) => void;
  setModelLayers: (layers: LayerInfo[]) => void;
  setModelBounds: (bounds: ModelBounds) => void;
  setModelScale: (scale: number) => void;
  setModelTransform: (transform: ModelTransformSnapshot | null) => void;
  setModelBuildings: (buildings: PlanViewBuilding[]) => void;
  setModelError: (error: string | null) => void;
  resetModel: () => void;
}

const initialState = {
  externalModelUrl: null,
  externalModelType: null,
  externalModelName: null,
  externalModelFile: null,
  modelFilePath: null,
  modelLayers: [] as LayerInfo[],
  modelBounds: undefined as ModelBounds,
  modelScale: 1,
  modelTransform: null as ModelTransformSnapshot | null,
  modelBuildings: [] as PlanViewBuilding[],
  modelError: null as string | null,
};

export const useModelStore = create<ModelState>((set) => ({
  ...initialState,
  setExternalModel: ({ url, type, name, file }) =>
    set({
      externalModelUrl: url,
      externalModelType: type,
      externalModelName: name ?? null,
      externalModelFile: file ?? null,
    }),
  setModelFilePath: (path) => set({ modelFilePath: path }),
  setModelLayers: (layers) => set({ modelLayers: layers }),
  setModelBounds: (bounds) => set({ modelBounds: bounds }),
  setModelScale: (scale) => set({ modelScale: scale }),
  setModelTransform: (transform) => set({ modelTransform: transform }),
  setModelBuildings: (buildings) => set({ modelBuildings: buildings }),
  setModelError: (error) => set({ modelError: error }),
  resetModel: () => set({ ...initialState }),
}));
