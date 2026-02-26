/** 广场退线检测 - 注册到 toolRegistry */
import { Square } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { PlazaSetbackPanel } from "./panel";
import { PlazaSetbackSceneLayer } from "./scene";
import { usePlazaSetbackStore } from "./store";

toolRegistry.register({
  id: "plaza-setback-check",
  name: "广场退线检测",
  description: "检测广场退线内是否存在超高建筑",
  category: "building",
  status: "implemented",
  apiEndpoint: "/plaza-setback-check",
  icon: Square,
  Panel: PlazaSetbackPanel,
  SceneLayer: PlazaSetbackSceneLayer,
  reset: () => usePlazaSetbackStore.getState().reset(),
});
