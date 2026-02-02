import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { ControlCategory } from "@/lib/city-data";
import type { ToolStatus } from "@/lib/navigation-types";
import type { CitySceneProps } from "@/components/city-scene";

export interface ToolRegistration {
  id: string;
  name: string;
  description: string;
  category: ControlCategory;
  status: ToolStatus;
  apiEndpoint?: string;
  ghDefinition?: string;
  icon: LucideIcon;
  Panel?: ComponentType;
  useSceneState?: () => Partial<CitySceneProps>;
  reset?: () => void;
}

class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();
  private order: string[] = [];

  register(tool: ToolRegistration) {
    if (!this.tools.has(tool.id)) {
      this.order.push(tool.id);
    }
    this.tools.set(tool.id, tool);
  }

  getAll(): ToolRegistration[] {
    return this.order
      .map((id) => this.tools.get(id))
      .filter((tool): tool is ToolRegistration => Boolean(tool));
  }

  get(id: string): ToolRegistration | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  resetAll() {
    this.getAll().forEach((tool) => tool.reset?.());
  }
}

export const toolRegistry = new ToolRegistry();

const useEmptySceneState = () => ({});

export const useToolSceneProps = (): Partial<CitySceneProps> => {
  const tools = toolRegistry.getAll();
  const scenePropsList = tools.map((tool) => (tool.useSceneState ?? useEmptySceneState)());
  return scenePropsList.reduce((acc, current) => ({ ...acc, ...current }), {});
};
