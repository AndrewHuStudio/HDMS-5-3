// 导航配置文件 - 定义主导航结构和管控工具的元数据

import { MessageSquare, ClipboardCheck, Upload } from "lucide-react";
import type { NavigationItem } from "./navigation-types";

// 主导航配置（不包含子菜单，子菜单在主页面动态生成）
export const mainNavigation: NavigationItem[] = [
  {
    id: "data-upload",
    label: "管控资料上传",
    icon: Upload,
    description: "资料上传与处理流程",
  },
  {
    id: "qa-assistant",
    label: "管控问答助手",
    icon: MessageSquare,
    description: "知识查询与图谱展示",
  },
  {
    id: "control-review",
    label: "管控审查系统",
    icon: ClipboardCheck,
    description: "管控工具",
    children: [], // 将在主页面中动态填充
  },
  {
    id: "approval-checklist",
    label: "管控审批清单",
    icon: ClipboardCheck,
    description: "一键生成审批清单",
  },
];
