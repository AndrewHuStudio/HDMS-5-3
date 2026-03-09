"use client";

import { useRef, useCallback } from "react";
import { useModelStore } from "@/lib/stores/model-store";
import { toolRegistry } from "@/lib/registries/tool-registry";
import type { ModelFileType } from "@/components/city-scene";
import type { LayerInfo } from "@/components/model-uploader";

export function useModelLoader() {
  const externalModelUrl = useModelStore((s) => s.externalModelUrl);
  const externalModelType = useModelStore((s) => s.externalModelType);
  const externalModelName = useModelStore((s) => s.externalModelName);
  const modelError = useModelStore((s) => s.modelError);
  const setExternalModel = useModelStore((s) => s.setExternalModel);
  const setModelFilePath = useModelStore((s) => s.setModelFilePath);
  const setModelLayers = useModelStore((s) => s.setModelLayers);
  const setModelBounds = useModelStore((s) => s.setModelBounds);
  const setModelScale = useModelStore((s) => s.setModelScale);
  const setModelTransform = useModelStore((s) => s.setModelTransform);
  const setModelBuildings = useModelStore((s) => s.setModelBuildings);
  const setModelError = useModelStore((s) => s.setModelError);
  const resetModel = useModelStore((s) => s.resetModel);

  const currentModelRef = useRef<{ url: string | null; type: ModelFileType | null }>({
    url: null,
    type: null,
  });

  const handleModelLoad = useCallback(
    (
      url: string,
      fileName: string,
      fileType: ModelFileType,
      modelPath?: string,
      layers?: LayerInfo[],
      file?: File
    ) => {
      const isSameModel =
        currentModelRef.current.url === url && currentModelRef.current.type === fileType;
      if (isSameModel) {
        if (modelPath) setModelFilePath(modelPath);
        if (layers) setModelLayers(layers);
        if (fileName || file)
          setExternalModel({ url, type: fileType, name: fileName, file: file ?? null });
        return;
      }
      setExternalModel({ url, type: fileType, name: fileName, file: file ?? null });
      currentModelRef.current = { url, type: fileType };
      setModelError(null);
      setModelFilePath(modelPath ?? null);
      setModelLayers(layers || []);
      setModelBounds(undefined);
      setModelScale(1);
      setModelTransform(null);
      setModelBuildings([]);
      toolRegistry.resetAll();
    },
    [
      setExternalModel,
      setModelFilePath,
      setModelLayers,
      setModelError,
      setModelBounds,
      setModelScale,
      setModelTransform,
      setModelBuildings,
    ]
  );

  const handleClearModel = useCallback(() => {
    const url = useModelStore.getState().externalModelUrl;
    if (url) URL.revokeObjectURL(url);
    currentModelRef.current = { url: null, type: null };
    resetModel();
    toolRegistry.resetAll();
  }, [resetModel]);

  return {
    externalModelUrl,
    externalModelType,
    externalModelName,
    modelError,
    setModelError,
    setModelBounds,
    setModelScale,
    setModelTransform,
    setModelBuildings,
    handleModelLoad,
    handleClearModel,
  };
}
