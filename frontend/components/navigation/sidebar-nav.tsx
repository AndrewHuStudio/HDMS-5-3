"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, ChevronDown, ChevronRight, Square, SquareX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavigationItem } from "@/lib/navigation-types";

interface SidebarNavProps {
  items: NavigationItem[];
  activeId: string;
  onNavigate?: (id: string) => void;
}

export function SidebarNav({ items, activeId, onNavigate }: SidebarNavProps) {
  const router = useRouter();
  // 默认展开"管控审查系统"
  const [expandedItems, setExpandedItems] = useState<Set<string>>(
    new Set(["control-review"])
  );

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderToolRunStatus = (status?: NavigationItem["toolRunStatus"]) => (
    status === "pass" ? (
      <CheckSquare aria-hidden className="h-4 w-4 text-green-600" />
    ) : status === "fail" ? (
      <SquareX aria-hidden className="h-4 w-4 text-red-600" />
    ) : (
      <Square aria-hidden className="h-4 w-4 text-slate-300" />
    )
  );

  const renderNavItem = (item: NavigationItem, level: number = 0) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const isActive = activeId === item.id;
    const showToolStatus = level > 0 && !hasChildren;

    return (
      <div key={item.id}>
        <button
          onClick={() => {
            if (hasChildren) {
              toggleExpand(item.id);
            } else if (item.href) {
              router.push(item.href);
            } else {
              onNavigate?.(item.id);
            }
          }}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors",
            level > 0 && "pl-8",
            isActive
              ? "bg-secondary text-foreground font-medium"
              : "text-muted-foreground hover:bg-secondary/50"
          )}
        >
          {showToolStatus && renderToolRunStatus(item.toolRunStatus)}
          <item.icon className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          {hasChildren && (
            isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          )}
        </button>

        {hasChildren && isExpanded && (
          <div className="bg-secondary/20">
            {item.children!.map((child) => renderNavItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav className="flex-1 min-h-0 overflow-auto py-2">
      {items.map((item) => renderNavItem(item))}
    </nav>
  );
}
