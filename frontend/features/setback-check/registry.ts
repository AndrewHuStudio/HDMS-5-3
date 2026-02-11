import { Ruler } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { SetbackPanel } from "./panel";
import { SetbackSceneLayer } from "./scene";
import { useSetbackCheckStore } from "./store";

toolRegistry.register({
  id: "setback-check",
  name: "退线检测",
  description: "检测建筑是否超出建筑退线",
  category: "building",
  status: "implemented",
  apiEndpoint: "/setback-check",
  icon: Ruler,
  Panel: SetbackPanel,
  SceneLayer: SetbackSceneLayer,
  reset: () => useSetbackCheckStore.getState().reset(),
});
