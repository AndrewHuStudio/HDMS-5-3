"use client";

import { SetbackCheckPanel } from "@/components/setback-check-panel";
import { useModelStore } from "@/lib/stores/model-store";
import { useSetbackCheckStore } from "./store";

export function SetbackPanel() {
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);

  const result = useSetbackCheckStore((state) => state.result);
  const showHighlights = useSetbackCheckStore((state) => state.showHighlights);
  const setResult = useSetbackCheckStore((state) => state.setResult);
  const setShowHighlights = useSetbackCheckStore((state) => state.setShowHighlights);

  return (
    <SetbackCheckPanel
      modelFilePath={modelFilePath}
      modelFile={modelFile}
      onModelPathResolved={setModelFilePath}
      onResultChange={setResult}
      showHighlights={showHighlights}
      onShowHighlightsChange={setShowHighlights}
    />
  );
}
