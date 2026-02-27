"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { CorridorCollisionResult } from "@/lib/sight-corridor-types";

interface SightCorridorPanelProps {
  modelFilePath: string | null;
  modelFile?: File | null;
  corridorCollisionResult?: CorridorCollisionResult | null;
  corridorLayerVisible?: boolean;
  onCorridorCheckRequest?: () => void;
  onCorridorCheckClear?: () => void;
  showBlockingLabels?: boolean;
  onShowBlockingLabelsChange?: (show: boolean) => void;
  planViewportComponent?: React.ReactNode;
}

export function SightCorridorPanel({
  modelFilePath,
  modelFile,
  corridorCollisionResult = null,
  corridorLayerVisible = false,
  onCorridorCheckRequest,
  onCorridorCheckClear,
  showBlockingLabels,
  onShowBlockingLabelsChange,
  planViewportComponent,
}: SightCorridorPanelProps) {
  const [corridorError, setCorridorError] = useState<string | null>(null);
  const [localShowBlockingLabels, setLocalShowBlockingLabels] = useState(true);

  const corridorBlockedBuildings = corridorCollisionResult?.blocked_buildings ?? [];
  const corridorStatus = corridorCollisionResult?.status ?? null;
  const hasCorridorBlocks = corridorBlockedBuildings.length > 0;
  const showBlocking = showBlockingLabels ?? localShowBlockingLabels;
  const hasCorridorResult = corridorStatus === "clear" || corridorStatus === "blocked";

  const resolvedPlanViewport = useMemo(() => {
    if (!planViewportComponent) return null;
    return planViewportComponent;
  }, [planViewportComponent]);

  const handleCorridorCheck = () => {
    if (!modelFilePath && !modelFile) {
      setCorridorError("请先上传3dm模型文件");
      return;
    }
    setCorridorError(null);
    onCorridorCheckRequest?.();
  };

  const handleCorridorClear = () => {
    setCorridorError(null);
    onCorridorCheckClear?.();
  };

  return (
    <div className="space-y-2">
      <Card className="gap-0">
        <CardHeader className="px-3 py-0">
          <CardTitle className="text-sm">视线通廊检测</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3 pt-2">
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={handleCorridorCheck}
              disabled={!modelFilePath && !modelFile}
            >
              检测
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={handleCorridorClear}
              disabled={!corridorCollisionResult && !corridorLayerVisible}
            >
              清除检测结果
            </Button>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>显示阻挡建筑标记</span>
            <Switch
              checked={showBlocking}
              disabled={!corridorCollisionResult || !hasCorridorBlocks}
              onCheckedChange={(checked) => {
                if (onShowBlockingLabelsChange) {
                  onShowBlockingLabelsChange(checked);
                } else {
                  setLocalShowBlockingLabels(checked);
                }
              }}
            />
          </div>

          {corridorError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">{corridorError}</AlertDescription>
            </Alert>
          )}

          {corridorStatus === "missing_corridor" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">未找到图层：限制_视线通廊</AlertDescription>
            </Alert>
          )}

          {corridorStatus === "missing_buildings" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">未找到建筑体块图层（模型_建筑体块）</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">通廊检测结果</CardTitle>
            <div className="flex items-center gap-2">
              {corridorStatus === "clear" ? (
                <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  未遮挡
                </div>
              ) : corridorStatus === "blocked" ? (
                <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                  {corridorBlockedBuildings.length} 遮挡
                </div>
              ) : (
                <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-muted text-muted-foreground">
                  未检测
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2.5 max-h-[520px] overflow-y-auto pt-2">
          {corridorStatus === "clear" && (
            <div className="border rounded-lg p-3 transition-all hover:shadow-sm border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30">
              <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">视线通廊未发现遮挡</span>
              </div>
            </div>
          )}

          {corridorStatus === "blocked" &&
            corridorBlockedBuildings.map((building, index) => (
              <div
                key={`${building.mesh_id ?? building.building_name}-${index}`}
                className="border rounded-lg p-3 transition-all hover:shadow-sm border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{building.building_name}</span>
                  <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">通廊遮挡</span>
                  </div>
                </div>
                {(building.layer_name || building.layer_index !== undefined) && (
                  <div className="space-y-1 text-xs">
                    {building.layer_name && (
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-muted-foreground">图层:</span>
                        <span className="font-medium">{building.layer_name}</span>
                      </div>
                    )}
                    {building.layer_index !== undefined && (
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-muted-foreground">图层编号:</span>
                        <span className="font-medium">{building.layer_index}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

          {!hasCorridorResult && (
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              点击上方“检测”按钮后，将在此处显示通廊碰撞结果
            </div>
          )}

          {resolvedPlanViewport && <div className="border-t pt-2">{resolvedPlanViewport}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
