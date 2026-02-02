import { Move } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { SetbackPanel } from "./panel";
import { useSetbackCheckStore } from "./store";

const useSceneState = () => {
  const result = useSetbackCheckStore((state) => state.result);
  const highlightTarget = useSetbackCheckStore((state) => state.highlightTarget);
  const showSetbackLabels = useSetbackCheckStore((state) => state.showSetbackLabels);
  const setSelectedPlotName = useSetbackCheckStore((state) => state.setSelectedPlotName);

  return {
    setbackHighlightResult: result,
    setbackHighlightTarget: highlightTarget,
    showSetbackLabels,
    onSetbackPlotSelect: (plotName: string) => setSelectedPlotName(plotName),
  };
};

toolRegistry.register({
  id: "setback-check",
  name: "贴线率检测",
  description: "检测贴线率是否符合要求",
  category: "building",
  status: "implemented",
  apiEndpoint: "/setback-check",
  icon: Move,
  Panel: SetbackPanel,
  useSceneState,
  reset: () => useSetbackCheckStore.getState().reset(),
});
