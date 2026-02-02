"use client";

import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";
import type { ControlToolMeta } from "@/lib/navigation-types";

interface ToolPanelWrapperProps {
  tool: ControlToolMeta;
  children?: React.ReactNode;
}

export function ToolPanelWrapper({ tool, children }: ToolPanelWrapperProps) {
  // 如果工具状态是"计划中"，显示开发中提示
  if (tool.status === "planned") {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-secondary mx-auto flex items-center justify-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <div className="flex items-center justify-center gap-2">
              <p className="font-medium">{tool.name}</p>
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                开发中
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {tool.description}
            </p>
            <p className="text-xs text-amber-600 mt-2">
              该功能正在开发中，敬请期待
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 如果工具已实现，显示实际内容
  return <div className="h-full flex flex-col">{children}</div>;
}
