"use client";

import React from "react"

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Eye, 
  Grid3X3, 
  ArrowUpRight, 
  ArrowUpLeft, 
  ArrowDownRight, 
  ArrowDownLeft,
  Layers,
  ChevronDown
} from "lucide-react";
import type { ViewMode } from "./city-scene";

interface ViewControlsProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

const viewOptions: { value: ViewMode; label: string; icon: React.ReactNode; description: string }[] = [
  { value: "perspective", label: "透视视图", icon: <Eye className="h-4 w-4" />, description: "自由旋转视角" },
  { value: "isometric-ne", label: "东北视角", icon: <ArrowUpRight className="h-4 w-4" />, description: "轴测图 - 东北方向" },
  { value: "isometric-nw", label: "西北视角", icon: <ArrowUpLeft className="h-4 w-4" />, description: "轴测图 - 西北方向" },
  { value: "isometric-sw", label: "西南视角", icon: <ArrowDownLeft className="h-4 w-4" />, description: "轴测图 - 西南方向" },
  { value: "isometric-se", label: "东南视角", icon: <ArrowDownRight className="h-4 w-4" />, description: "轴测图 - 东南方向" },
  { value: "plan", label: "平面图", icon: <Grid3X3 className="h-4 w-4" />, description: "俯视平面视图" },
];

export function ViewControls({ currentView, onViewChange }: ViewControlsProps) {
  const currentOption = viewOptions.find(v => v.value === currentView) || viewOptions[0];

  return (
    <div className="flex items-center gap-2">
      {/* 下拉菜单选择器 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Layers className="h-4 w-4" />
            {currentOption.label}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuLabel>选择视角</DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          <DropdownMenuItem 
            onClick={() => onViewChange("perspective")}
            className={currentView === "perspective" ? "bg-muted" : ""}
          >
            <Eye className="h-4 w-4 mr-2" />
            <div>
              <p className="font-medium">透视视图</p>
              <p className="text-xs text-muted-foreground">自由旋转视角</p>
            </div>
          </DropdownMenuItem>
          
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">轴测图</DropdownMenuLabel>
          
          {viewOptions.filter(v => v.value.startsWith("isometric")).map((option) => (
            <DropdownMenuItem 
              key={option.value}
              onClick={() => onViewChange(option.value)}
              className={currentView === option.value ? "bg-muted" : ""}
            >
              {option.icon}
              <span className="ml-2">{option.label}</span>
            </DropdownMenuItem>
          ))}
          
          <DropdownMenuSeparator />
          
          <DropdownMenuItem 
            onClick={() => onViewChange("plan")}
            className={currentView === "plan" ? "bg-muted" : ""}
          >
            <Grid3X3 className="h-4 w-4 mr-2" />
            <div>
              <p className="font-medium">平面图</p>
              <p className="text-xs text-muted-foreground">俯视平面视图</p>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 快捷按钮 - 四个方向（东北->西北->西南->东南）*/}
      <div className="flex items-center border border-border rounded-md bg-card overflow-hidden">
        <Button 
          variant="ghost" 
          size="sm" 
          className={`h-8 w-8 p-0 rounded-none ${currentView === "isometric-ne" ? "bg-muted" : ""}`}
          onClick={() => onViewChange("isometric-ne")}
          title="东北视角"
        >
          <ArrowUpRight className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          className={`h-8 w-8 p-0 rounded-none border-l border-border ${currentView === "isometric-nw" ? "bg-muted" : ""}`}
          onClick={() => onViewChange("isometric-nw")}
          title="西北视角"
        >
          <ArrowUpLeft className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          className={`h-8 w-8 p-0 rounded-none border-l border-border ${currentView === "isometric-sw" ? "bg-muted" : ""}`}
          onClick={() => onViewChange("isometric-sw")}
          title="西南视角"
        >
          <ArrowDownLeft className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          className={`h-8 w-8 p-0 rounded-none border-l border-border ${currentView === "isometric-se" ? "bg-muted" : ""}`}
          onClick={() => onViewChange("isometric-se")}
          title="东南视角"
        >
          <ArrowDownRight className="h-4 w-4" />
        </Button>
      </div>

      {/* 平面图按钮 */}
      <Button 
        variant={currentView === "plan" ? "default" : "outline"} 
        size="sm" 
        className="gap-1"
        onClick={() => onViewChange("plan")}
      >
        <Grid3X3 className="h-4 w-4" />
        平面
      </Button>
    </div>
  );
}
