import { Flame } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { FireLadderPanel } from "./panel";
import { FireLadderSceneLayer } from "./scene";
import { useFireLadderStore } from "./store";

toolRegistry.register({
  id: "fire-ladder-check",
  name: "消防登高面检测",
  description: "检测消防登高面是否符合要求",
  category: "building",
  status: "implemented",
  apiEndpoint: "/fire-ladder-check",
  icon: Flame,
  Panel: FireLadderPanel,
  SceneLayer: FireLadderSceneLayer,
  reset: () => useFireLadderStore.getState().reset(),
});
