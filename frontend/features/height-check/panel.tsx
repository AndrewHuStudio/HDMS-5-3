"use client";

import { HeightCheckPanelPure } from "@/components/height-check-panel-pure";
import { useModelStore } from "@/lib/stores/model-store";
import { useHeightCheckStore } from "./store";

export function HeightCheckPanel() {
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);

  const results = useHeightCheckStore((state) => state.results);
  const warnings = useHeightCheckStore((state) => state.warnings);
  const volumes = useHeightCheckStore((state) => state.volumes);
  const showSetbackVolumes = useHeightCheckStore((state) => state.showSetbackVolumes);
  const showHeightCheckLabels = useHeightCheckStore((state) => state.showHeightCheckLabels);
  const setResults = useHeightCheckStore((state) => state.setResults);
  const setWarnings = useHeightCheckStore((state) => state.setWarnings);
  const setVolumes = useHeightCheckStore((state) => state.setVolumes);
  const setShowSetbackVolumes = useHeightCheckStore((state) => state.setShowSetbackVolumes);
  const setShowHeightCheckLabels = useHeightCheckStore((state) => state.setShowHeightCheckLabels);

  return (
    <HeightCheckPanelPure
      modelFilePath={modelFilePath}
      modelFile={modelFile}
      onModelPathResolved={setModelFilePath}
      results={results}
      warnings={warnings}
      volumes={volumes}
      onCheckResultsChange={setResults}
      onWarningsChange={setWarnings}
      onVolumesChange={setVolumes}
      showSetbackVolumes={showSetbackVolumes}
      onShowSetbackVolumesChange={setShowSetbackVolumes}
      showHeightCheckLabels={showHeightCheckLabels}
      onShowHeightCheckLabelsChange={setShowHeightCheckLabels}
    />
  );
}
