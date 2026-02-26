/**
 * 工具注册表
 *
 * 管理所有检测工具的注册和查询，提供统一的工具元数据管理：
 * - 工具基本信息（id、名称、描述、分类、状态）
 * - API 端点、Grasshopper 定义文件路径
 * - 关联的 Panel 组件、SceneLayer 组件、Overlay 组件
 * - 场景状态钩子、重置函数
 */
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
  SceneLayer?: ComponentType;
  Overlay?: ComponentType;
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
