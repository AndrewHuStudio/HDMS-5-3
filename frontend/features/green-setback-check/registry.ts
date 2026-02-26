/** 绿地退线检测 - 注册到 toolRegistry */
import { Leaf } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { GreenSetbackPanel } from "./panel";
import { GreenSetbackSceneLayer } from "./scene";
import { useGreenSetbackStore } from "./store";

toolRegistry.register({
  id: "green-setback-check",
  name: "绿地退线控制检测",
  description: "检测绿地退线内是否存在超高建筑",
  category: "building",
  status: "implemented",
  apiEndpoint: "/green-setback-check",
  icon: Leaf,
  Panel: GreenSetbackPanel,
  SceneLayer: GreenSetbackSceneLayer,
  reset: () => useGreenSetbackStore.getState().reset(),
});
