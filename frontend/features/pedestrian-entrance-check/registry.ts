import { PersonStanding } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { PedestrianEntrancePanel } from "./panel";

toolRegistry.register({
  id: "pedestrian-entrance-check",
  name: "人行出入口检测",
  description: "正在开发中",
  category: "building",
  status: "planned",
  icon: PersonStanding,
  Panel: PedestrianEntrancePanel,
});
