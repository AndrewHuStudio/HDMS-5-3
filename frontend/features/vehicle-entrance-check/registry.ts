/** 车行出入口检测 - 注册到 toolRegistry */
import { Car } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { VehicleEntrancePanel } from "./panel";
import { VehicleEntranceSceneLayer } from "./scene";
import { useVehicleEntranceStore } from "./store";

toolRegistry.register({
  id: "vehicle-entrance-check",
  name: "车行出入口检测",
  description: "检测车行出入口与交叉口的距离是否达标",
  category: "building",
  status: "implemented",
  apiEndpoint: "/vehicle-entrance-check",
  icon: Car,
  Panel: VehicleEntrancePanel,
  SceneLayer: VehicleEntranceSceneLayer,
  reset: () => useVehicleEntranceStore.getState().reset(),
});
