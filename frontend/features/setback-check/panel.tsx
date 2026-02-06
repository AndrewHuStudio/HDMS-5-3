"use client";

import { SetbackCheckPanel } from "@/components/setback-check-panel";
import { useModelStore } from "@/lib/stores/model-store";
import { useSetbackCheckStore } from "./store";

export function SetbackPanel() {
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);

  const result = useSetbackCheckStore((state) => state.result);
  const highlightTarget = useSetbackCheckStore((state) => state.highlightTarget);
  const selectedPlotName = useSetbackCheckStore((state) => state.selectedPlotName);
  const showSetbackLabels = useSetbackCheckStore((state) => state.showSetbackLabels);
  const setResult = useSetbackCheckStore((state) => state.setResult);
  const setHighlightTarget = useSetbackCheckStore((state) => state.setHighlightTarget);
  const setShowSetbackLabels = useSetbackCheckStore((state) => state.setShowSetbackLabels);

  return (
    <SetbackCheckPanel
      modelFilePath={modelFilePath}
      modelFile={modelFile}
      onModelPathResolved={setModelFilePath}
      onResultChange={setResult}
      onHighlightTargetChange={setHighlightTarget}
      selectedPlotName={selectedPlotName}
      showSetbackLabels={showSetbackLabels}
      onShowSetbackLabelsChange={setShowSetbackLabels}
    />
  );
}
