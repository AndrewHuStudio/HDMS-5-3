import { Bridge } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { SkyBridgePanel } from "./panel";
import { SkyBridgeSceneLayer } from "./scene";
import { useSkyBridgeStore } from "./store";

toolRegistry.register({
  id: "sky-bridge",
  name: "空中连廊检测",
  description: "检测空中连廊是否符合规范要求",
  category: "building",
  status: "implemented",
  apiEndpoint: "/sky-bridge-check",
  icon: Bridge,
  Panel: SkyBridgePanel,
  SceneLayer: SkyBridgeSceneLayer,
  reset: () => useSkyBridgeStore.getState().reset(),
});
