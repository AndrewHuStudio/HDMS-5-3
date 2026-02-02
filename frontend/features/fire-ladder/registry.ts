import { Flame } from "lucide-react";
import { toolRegistry } from "@/lib/registries/tool-registry";

const EmptyPanel = () => null;

toolRegistry.register({
  id: "fire-ladder-check",
  name: "消防登高面检测",
  description: "检测消防登高面是否符合要求",
  category: "building",
  status: "planned",
  apiEndpoint: "/fire-ladder-check",
  icon: Flame,
  Panel: EmptyPanel,
});
