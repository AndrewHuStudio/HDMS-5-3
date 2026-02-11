// 导航类型定义文件

import type { LucideIcon } from "lucide-react";
import type { ControlCategory } from "./city-data";

export type NavigationItemId = string;

// 管控工具类型（动态注册，避免新增工具时修改公共文件）
export type ControlToolType = string;

// 导航项配置接口
export interface NavigationItem {
  id: NavigationItemId;
  label: string;
  icon: LucideIcon;
  description?: string;
  children?: NavigationItem[];
}

// 工具状态
export type ToolStatus = "implemented" | "planned" | "disabled";

// 工具元数据接口
export interface ControlToolMeta {
  id: ControlToolType;
  name: string;
  description: string;
  category: ControlCategory;
  status: ToolStatus;
  apiEndpoint?: string;
  ghDefinition?: string;
  icon: LucideIcon;
}

// 活动视图类型（用于主页面状态管理）
export type ActiveView =
  | "data-upload"         // 管控资料上传
  | "qa-assistant"        // 管控问答助手
  | "approval-checklist"  // 管控审批清单
  | ControlToolType;       // 管控工具（动态注册）
