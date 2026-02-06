import { Eye } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { useModelStore } from "@/lib/stores/model-store";
import { useSightCorridorStore } from "./store";
import { SightCorridorPanelAdapter } from "./panel";

const useSceneState = () => {
  const position = useSightCorridorStore((state) => state.position);
  const radius = useSightCorridorStore((state) => state.radius);
  const result = useSightCorridorStore((state) => state.result);
  const collisionResult = useSightCorridorStore((state) => state.collisionResult);
  const showCorridorLayer = useSightCorridorStore((state) => state.showCorridorLayer);
  const showLabels = useSightCorridorStore((state) => state.showLabels);
  const showBlockingLabels = useSightCorridorStore((state) => state.showBlockingLabels);
  const modelScale = useModelStore((state) => state.modelScale);

  return {
    sightCorridorPosition: position,
    sightCorridorScale: modelScale,
    sightCorridorRadius: radius,
    sightCorridorResult: position ? result : null,
    corridorCollisionResult: collisionResult,
    showSightCorridorLayer: showCorridorLayer,
    showSightCorridorLabels: showLabels,
    showBlockingLabels: showBlockingLabels,
  };
};

toolRegistry.register({
  id: "view-corridor-check",
  name: "视线通廊检测",
  description: "交互式视域分析工具",
  category: "building",
  status: "implemented",
  apiEndpoint: "/sight-corridor/check",
  icon: Eye,
  Panel: SightCorridorPanelAdapter,
  useSceneState,
  reset: () => useSightCorridorStore.getState().reset(),
});
