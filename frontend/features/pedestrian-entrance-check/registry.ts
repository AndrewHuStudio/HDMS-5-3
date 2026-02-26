/** 人行出入口检测 - 注册到 toolRegistry */
import { PersonStanding } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { PedestrianEntrancePanel } from "./panel";
import { PedestrianEntranceSceneLayer } from "./scene";
import { usePedestrianEntranceStore } from "./store";

toolRegistry.register({
  id: "pedestrian-entrance-check",
  name: "人行出入口检测",
  description: "统计建筑红线上或建筑红线内的人行出入口数量是否达标",
  category: "building",
  status: "implemented",
  apiEndpoint: "/pedestrian-entrance-check",
  icon: PersonStanding,
  Panel: PedestrianEntrancePanel,
  SceneLayer: PedestrianEntranceSceneLayer,
  reset: () => usePedestrianEntranceStore.getState().reset(),
});
