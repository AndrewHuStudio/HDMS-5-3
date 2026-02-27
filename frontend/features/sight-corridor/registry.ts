import { Eye } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { useSightCorridorStore } from "./store";
import { SightCorridorPanelAdapter } from "./panel";
import { SIGHT_CORRIDOR_DISPLAY_ELEVATION } from "./constants";

const useSceneState = () => {
  const collisionResult = useSightCorridorStore((state) => state.collisionResult);
  const showCorridorLayer = useSightCorridorStore((state) => state.showCorridorLayer);
  const showBlockingLabels = useSightCorridorStore((state) => state.showBlockingLabels);

  return {
    corridorCollisionResult: collisionResult,
    showSightCorridorLayer: showCorridorLayer,
    showBlockingLabels,
    sightCorridorDisplayElevation: SIGHT_CORRIDOR_DISPLAY_ELEVATION,
  };
};

toolRegistry.register({
  id: "view-corridor-check",
  name: "视线通廊检测",
  description: "视线通廊碰撞检测工具",
  category: "building",
  status: "implemented",
  apiEndpoint: "/sight-corridor/collision",
  icon: Eye,
  Panel: SightCorridorPanelAdapter,
  useSceneState,
  reset: () => useSightCorridorStore.getState().reset(),
});
