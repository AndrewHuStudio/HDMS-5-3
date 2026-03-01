/** 空中连廊检测 - 注册到 toolRegistry */
import { Link2 } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { SkyBridgePanel } from "./panel";
import { SkyBridgeSceneLayer } from "./scene";
import { useSkyBridgeStore } from "./store";

toolRegistry.register({
  id: "sky-bridge-check",
  name: "空中连廊检测",
  description: "检测空中连廊是否满足连接与尺寸要求",
  category: "building",
  status: "implemented",
  apiEndpoint: "/sky-bridge-check",
  icon: Link2,
  Panel: SkyBridgePanel,
  SceneLayer: SkyBridgeSceneLayer,
  reset: () => useSkyBridgeStore.getState().reset(),
});
