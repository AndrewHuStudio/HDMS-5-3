import { Layers } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { HeightCheckPanel } from "./panel";
import { useHeightCheckStore } from "./store";

const useSceneState = () => {
  const results = useHeightCheckStore((state) => state.results);
  const volumes = useHeightCheckStore((state) => state.volumes);
  const showSetbackVolumes = useHeightCheckStore((state) => state.showSetbackVolumes);
  const showHeightCheckLabels = useHeightCheckStore((state) => state.showHeightCheckLabels);
  return {
    heightCheckResults: results,
    setbackVolumes: volumes,
    showSetbackVolumes,
    showHeightCheckLabels,
  };
};

toolRegistry.register({
  id: "height-check",
  name: "限高检测",
  description: "检测建筑是否符合限高要求",
  category: "building",
  status: "implemented",
  apiEndpoint: "/height-check/pure-python",
  icon: Layers,
  Panel: HeightCheckPanel,
  useSceneState,
  reset: () => useHeightCheckStore.getState().reset(),
});
