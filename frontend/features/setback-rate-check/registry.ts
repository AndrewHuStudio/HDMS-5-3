import { Move } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { SetbackRatePanel } from "./panel";
import { useSetbackRateCheckStore } from "./store";

const useSceneState = () => {
  const result = useSetbackRateCheckStore((state) => state.result);
  const highlightTarget = useSetbackRateCheckStore((state) => state.highlightTarget);
  const showSetbackLabels = useSetbackRateCheckStore((state) => state.showSetbackLabels);
  const setSelectedPlotName = useSetbackRateCheckStore((state) => state.setSelectedPlotName);
  const selectedPlotName = useSetbackRateCheckStore((state) => state.selectedPlotName);
  const setHighlightTarget = useSetbackRateCheckStore((state) => state.setHighlightTarget);

  return {
    setbackHighlightResult: result,
    setbackHighlightTarget: highlightTarget,
    showSetbackLabels,
    selectedSetbackPlotName: selectedPlotName,
    onSetbackPlotSelect: (plotName: string) => {
      setSelectedPlotName(plotName);
      setHighlightTarget({ type: "plot", plotName });
    },
  };
};

toolRegistry.register({
  id: "setback-rate-check",
  name: "贴线率检测",
  description: "检测贴线率是否符合要求",
  category: "building",
  status: "implemented",
  apiEndpoint: "/setback-rate-check",
  icon: Move,
  Panel: SetbackRatePanel,
  useSceneState,
  reset: () => useSetbackRateCheckStore.getState().reset(),
});
