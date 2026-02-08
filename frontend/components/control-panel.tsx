"use client";

import React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { CityElement, ControlIndicator, ControlStatus, ControlCategory } from "@/lib/city-data";
import { elementTypeNames, statusConfig, controlCategoryNames, visualTypeNames } from "@/lib/city-data";
import {
  Building2,
  MapPin,
  Calendar,
  User,
  Layers,
  Ruler,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
} from "lucide-react";

interface ControlPanelProps {
  selectedElement: CityElement | null;
}

function StatusBadge({ status }: { status: ControlStatus }) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={`${config.color} ${config.bgColor} border-0`}>
      {status === "safe" && <CheckCircle2 className="h-3 w-3 mr-1" />}
      {status === "in-progress" && <Clock className="h-3 w-3 mr-1" />}
      {status === "exceeded" && <AlertTriangle className="h-3 w-3 mr-1" />}
      {config.label}
    </Badge>
  );
}

function ControlIndicatorCard({ indicator }: { indicator: ControlIndicator }) {
  const isNumeric =
    typeof indicator.currentValue === "number" &&
    typeof indicator.limitValue === "number";

  const progressValue = isNumeric
    ? Math.min(
        ((indicator.currentValue as number) / (indicator.limitValue as number)) * 100,
        120
      )
    : 0;

  const getProgressColor = () => {
    if (indicator.status === "exceeded") return "bg-red-400";
    if (indicator.status === "in-progress") return "bg-amber-400";
    return "bg-emerald-400";
  };

  return (
    <div className="p-4 bg-muted/40 border border-border rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground">{indicator.name}</span>
          {indicator.visualType && (
            <span className="text-xs px-1.5 py-0.5 bg-blue-100/70 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 rounded">
              {visualTypeNames[indicator.visualType]}
            </span>
          )}
          {indicator.isRigid && (
            <span className="text-xs px-1.5 py-0.5 bg-red-100/70 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded">
              刚性
            </span>
          )}
        </div>
        <StatusBadge status={indicator.status} />
      </div>

      <div className="flex items-center justify-between text-sm">
        <div>
          <span className="text-muted-foreground">当前值: </span>
          <span className="font-mono font-medium">
            {indicator.currentValue}
            {indicator.unit}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">限制值: </span>
          <span className="font-mono">
            {indicator.limitValue}
            {indicator.unit}
          </span>
        </div>
      </div>

      {isNumeric && (
        <div className="relative">
          <Progress value={Math.min(progressValue, 100)} className="h-2" />
          <div
            className={`absolute top-0 left-0 h-2 rounded-full transition-all ${getProgressColor()}`}
            style={{ width: `${Math.min(progressValue, 100)}%` }}
          />
          {progressValue > 100 && (
            <div
              className="absolute top-0 h-2 bg-destructive/50 rounded-r-full"
              style={{
                left: "100%",
                width: `${Math.min(progressValue - 100, 20)}%`,
                marginLeft: "-2px",
              }}
            />
          )}
        </div>
      )}

      {indicator.source && (
        <p className="text-xs text-muted-foreground">
          依据: {indicator.source}
        </p>
      )}

      {indicator.suggestion && (
        <div className="flex gap-2 p-2 bg-amber-50 rounded border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800">
          <Info className="h-4 w-4 text-amber-600 dark:text-amber-300 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-200">{indicator.suggestion}</p>
        </div>
      )}
    </div>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

export function ControlPanel({ selectedElement }: ControlPanelProps) {
  if (!selectedElement) {
    return (
      <Card className="h-full bg-card border-border">
        <CardContent className="h-full flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-secondary mx-auto flex items-center justify-center">
              <MapPin className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">未选择要素</p>
              <p className="text-sm text-muted-foreground">
                请在3D模型中点击选择一个城市要素
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const safeCount = selectedElement.controls.filter((c) => c.status === "safe").length;
  const inProgressCount = selectedElement.controls.filter(
    (c) => c.status === "in-progress"
  ).length;
  const exceededCount = selectedElement.controls.filter(
    (c) => c.status === "exceeded"
  ).length;
  const totalCount = selectedElement.controls.length;

  return (
    <Card className="h-full flex flex-col bg-card border-border">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{selectedElement.name}</CardTitle>
            <Badge variant="outline" className="mt-2">
              {elementTypeNames[selectedElement.type]}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            {exceededCount > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                {exceededCount}
              </Badge>
            )}
            {inProgressCount > 0 && (
              <Badge className="gap-1 bg-amber-500 text-white">
                <Clock className="h-3 w-3" />
                {inProgressCount}
              </Badge>
            )}
            {safeCount > 0 && (
              <Badge className="gap-1 bg-emerald-500 text-white">
                <CheckCircle2 className="h-3 w-3" />
                {safeCount}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-6">
            {/* 基本信息 */}
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                基本信息
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <InfoItem
                  icon={Layers}
                  label="面积"
                  value={`${selectedElement.info.area.toLocaleString()} ㎡`}
                />
                <InfoItem icon={MapPin} label="用途" value={selectedElement.info.usage} />
                {selectedElement.info.floors && (
                  <InfoItem icon={Building2} label="楼层" value={`${selectedElement.info.floors} 层`} />
                )}
                {selectedElement.info.height && (
                  <InfoItem icon={Ruler} label="高度" value={`${selectedElement.info.height} m`} />
                )}
                {selectedElement.info.owner && (
                  <InfoItem icon={User} label="产权方" value={selectedElement.info.owner} />
                )}
                {selectedElement.info.buildDate && (
                  <InfoItem icon={Calendar} label="建设日期" value={selectedElement.info.buildDate} />
                )}
              </div>
            </div>

            <Separator />

            {/* 管控指标 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  管控指标
                </h3>
                <span className="text-xs text-muted-foreground">
                  {safeCount}/{totalCount} 项符合
                </span>
              </div>

              {/* 状态概览 */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 rounded-lg text-center">
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-300">{safeCount}</p>
                  <p className="text-xs text-muted-foreground">符合</p>
                </div>
                <div className="p-3 bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 rounded-lg text-center">
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-300">{inProgressCount}</p>
                  <p className="text-xs text-muted-foreground">进展中</p>
                </div>
                <div className="p-3 bg-red-50 border border-red-200 dark:bg-red-950/40 dark:border-red-800 rounded-lg text-center">
                  <p className="text-2xl font-bold text-red-600 dark:text-red-300">{exceededCount}</p>
                  <p className="text-xs text-muted-foreground">超标</p>
                </div>
              </div>

              {/* 指标详情 */}
              <div className="space-y-3">
                {selectedElement.controls.map((indicator) => (
                  <ControlIndicatorCard key={indicator.id} indicator={indicator} />
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
