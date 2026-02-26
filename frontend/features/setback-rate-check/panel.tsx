/**
 * 退线贴线率检测面板（薄包装）
 * 将 Zustand store 状态注入到共享的 SetbackRateCheckPanel 组件。
 */
"use client";

import { SetbackRateCheckPanel } from "@/components/setback-rate-check-panel";
import { useModelStore } from "@/lib/stores/model-store";
import { useSetbackRateCheckStore } from "./store";

export function SetbackRatePanel() {
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);

  const showSetbackLabels = useSetbackRateCheckStore((state) => state.showSetbackLabels);
  const selectedPlotName = useSetbackRateCheckStore((state) => state.selectedPlotName);
  const setResult = useSetbackRateCheckStore((state) => state.setResult);
  const setHighlightTarget = useSetbackRateCheckStore((state) => state.setHighlightTarget);
  const setShowSetbackLabels = useSetbackRateCheckStore((state) => state.setShowSetbackLabels);
  const setSelectedPlotName = useSetbackRateCheckStore((state) => state.setSelectedPlotName);

  return (
    <SetbackRateCheckPanel
      modelFilePath={modelFilePath}
      modelFile={modelFile}
      onModelPathResolved={setModelFilePath}
      onResultChange={setResult}
      onHighlightTargetChange={setHighlightTarget}
      selectedPlotName={selectedPlotName}
      onSelectedPlotNameChange={setSelectedPlotName}
      showSetbackLabels={showSetbackLabels}
      onShowSetbackLabelsChange={setShowSetbackLabels}
    />
  );
}
