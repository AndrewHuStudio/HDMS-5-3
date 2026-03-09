"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { Building2 } from "lucide-react";
import { SidebarNav } from "@/components/navigation/sidebar-nav";
import { mainNavigation } from "@/lib/navigation-config";
import { toolRegistry } from "@/lib/registries/tool-registry";
import type { NavigationItem } from "@/lib/navigation-types";

// 路径 → 导航 id 映射
const PATH_TO_NAV_ID: Record<string, string> = {
  "/uploads": "data-upload",
  "/assistant": "qa-assistant",
  "/reviews": "control-review",
  "/approvals": "approval-checklist",
};

interface AppShellProps {
  children: React.ReactNode;
  /** /reviews 页面传入工具状态，用于子菜单状态图标 */
  toolStatusMap?: Record<string, "idle" | "pass" | "fail">;
  /** /reviews 页面传入当前激活工具 id，用于子菜单高亮 */
  activeToolId?: string;
  /** /reviews 页面传入工具切换回调 */
  onToolNavigate?: (id: string) => void;
}

export function AppShell({ children, toolStatusMap = {}, activeToolId, onToolNavigate }: AppShellProps) {
  const pathname = usePathname();
  const navActiveId = PATH_TO_NAV_ID[pathname] ?? "data-upload";
  const activeId = activeToolId || navActiveId;

  const tools = toolRegistry.getAll();

  const navigationWithTools = useMemo<NavigationItem[]>(() => {
    return mainNavigation.map((item) => {
      if (item.id === "control-review") {
        return {
          ...item,
          description: `${tools.length} 个管控工具`,
          children: tools.map((tool) => ({
            id: tool.id,
            label: tool.name,
            icon: tool.icon,
            description: tool.description,
            toolRunStatus: toolStatusMap[tool.id] ?? "idle",
          })),
        };
      }
      return item;
    });
  }, [tools, toolStatusMap]);

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      <aside className="w-[200px] border-r border-border bg-card flex flex-col flex-shrink-0 min-h-0 overflow-hidden">
        <div className="h-12 border-b border-border flex items-center px-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
              <Building2 className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="text-xs font-medium leading-tight">高强度片区</p>
              <p className="text-xs font-medium leading-tight">数字化管控平台</p>
            </div>
          </div>
        </div>

        <SidebarNav
          items={navigationWithTools}
          activeId={activeId}
          onNavigate={onToolNavigate}
        />
      </aside>

      {children}
    </div>
  );
}
