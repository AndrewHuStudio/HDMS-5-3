/**
 * 车行出入口检测面板
 * 配置主/次/支路交叉口最小距离参数，调用后端检测接口，展示每个出入口的合规状态。
 * 点击结果条目可在 3D 场景中高亮对应出入口。
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, Loader2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useModelStore } from "@/lib/stores/model-store";
import { resolveApiBase } from "@/lib/api-base";
import { checkVehicleEntrance } from "./api";
import { useVehicleEntranceStore } from "./store";
import type { VehicleEntranceResult } from "./types";

const DEFAULT_LAYERS = {
  entrance: "场地_车行出入口",
  mainIntersection: "场地_主干路交叉口",
  secondaryIntersection: "场地_次干路交叉口",
  branchIntersection: "场地_支路交叉口",
};

const reasonLabels: Record<string, string> = {
  too_close_main_intersection: "主干路交叉口距离不足",
  too_close_secondary_intersection: "次干路交叉口距离不足",
  too_close_branch_intersection: "支路交叉口距离不足",
};

export function VehicleEntrancePanel() {
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);

  const result = useVehicleEntranceStore((state) => state.result);
  const showHighlights = useVehicleEntranceStore((state) => state.showHighlights);
  const selectedEntranceId = useVehicleEntranceStore((state) => state.selectedEntranceId);
  const setResult = useVehicleEntranceStore((state) => state.setResult);
  const setShowHighlights = useVehicleEntranceStore((state) => state.setShowHighlights);
  const setSelectedEntranceId = useVehicleEntranceStore((state) => state.setSelectedEntranceId);

  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minMainDistance, setMinMainDistance] = useState(100);
  const [minSecondaryDistance, setMinSecondaryDistance] = useState(80);
  const [minBranchDistance, setMinBranchDistance] = useState(50);
  const [uploadedModelPath, setUploadedModelPath] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const effectiveModelPath =
    modelFilePath || (modelFile?.name === uploadedFileName ? uploadedModelPath : null);

  useEffect(() => {
    setUploadedModelPath(null);
    setUploadedFileName(null);
  }, [modelFile]);

  const resolveModelPath = async () => {
    let resolvedModelPath = effectiveModelPath;
    if (resolvedModelPath) return resolvedModelPath;

    if (!modelFile) {
      setError("请先上传3dm模型文件");
      return null;
    }

    const formData = new FormData();
    formData.append("file", modelFile);
    const apiBase = await resolveApiBase();

    const uploadResponse = await fetch(`${apiBase}/models/import?skip_layers=true`, {
      method: "POST",
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json().catch(() => ({}));
      throw new Error(errorData.detail || "模型上传失败");
    }

    const uploadData = await uploadResponse.json();
    resolvedModelPath = uploadData.model_path;
    if (resolvedModelPath) {
      setUploadedModelPath(resolvedModelPath);
      setUploadedFileName(modelFile.name);
      setModelFilePath(resolvedModelPath);
    }

    return resolvedModelPath ?? null;
  };

  const handleStartCheck = async () => {
    try {
      setIsChecking(true);
      setError(null);

      const resolvedModelPath = await resolveModelPath();
      if (!resolvedModelPath) return;

      const data = await checkVehicleEntrance({
        model_path: resolvedModelPath,
        entrance_layer: DEFAULT_LAYERS.entrance,
        main_intersection_layer: DEFAULT_LAYERS.mainIntersection,
        secondary_intersection_layer: DEFAULT_LAYERS.secondaryIntersection,
        branch_intersection_layer: DEFAULT_LAYERS.branchIntersection,
        min_main_distance: minMainDistance,
        min_secondary_distance: minSecondaryDistance,
        min_branch_distance: minBranchDistance,
      });

      setResult(data);
      setShowHighlights(true);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes("Failed to fetch")) {
        const apiBase = await resolveApiBase({ forceRefresh: true });
        setError(`无法连接后端服务，请确认后端已启动（${apiBase}）`);
      } else {
        setError(err instanceof Error ? err.message : "未知错误");
      }
    } finally {
      setIsChecking(false);
    }
  };

  const handleClearResults = () => {
    setResult(null);
    setError(null);
    setShowHighlights(false);
    setSelectedEntranceId(null);
  };

  const hasResults = Boolean(result);
  const passed = result?.summary?.passed ?? 0;
  const failed = result?.summary?.failed ?? 0;

  const items = useMemo(() => result?.results ?? [], [result]);

  useEffect(() => {
    if (!selectedEntranceId) return;
    const element = document.querySelector(
      `[data-entrance-id="${selectedEntranceId}"]`
    ) as HTMLElement | null;
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedEntranceId]);

  return (
    <div className="space-y-3">
      <Card className="gap-0">
        <CardHeader className="pb-1">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              1
            </div>
            <CardTitle className="text-sm">可视化选项</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white dark:bg-gray-800 shadow-sm">
                <Eye className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <Label className="text-sm font-medium cursor-pointer">显示检测标记</Label>
                <p className="text-xs text-muted-foreground">
                  {hasResults ? `${failed} 个不合规` : "暂无检测结果"}
                </p>
              </div>
            </div>
            <Switch
              checked={showHighlights}
              disabled={!hasResults}
              onCheckedChange={(checked) => setShowHighlights(checked)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0">
        <CardHeader className="pb-1">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              2
            </div>
            <CardTitle className="text-sm">配置参数</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          <div className="grid gap-3">
            <div className="space-y-2">
              <Label htmlFor="vehicle-main-distance">主干路交叉口最小距离(m)</Label>
              <Input
                id="vehicle-main-distance"
                type="number"
                min={0}
                step={1}
                value={minMainDistance}
                onChange={(e) => setMinMainDistance(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehicle-secondary-distance">次干路交叉口最小距离(m)</Label>
              <Input
                id="vehicle-secondary-distance"
                type="number"
                min={0}
                step={1}
                value={minSecondaryDistance}
                onChange={(e) => setMinSecondaryDistance(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehicle-branch-distance">支路交叉口最小距离(m)</Label>
              <Input
                id="vehicle-branch-distance"
                type="number"
                min={0}
                step={1}
                value={minBranchDistance}
                onChange={(e) => setMinBranchDistance(Number(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0">
        <CardHeader className="pb-1">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              3
            </div>
            <CardTitle className="text-sm">开始检测</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-1">
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleStartCheck} disabled={isChecking}>
              {isChecking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  检测中...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  开始检测
                </>
              )}
            </Button>
            <Button variant="outline" onClick={handleClearResults} disabled={isChecking || !hasResults}>
              <X className="mr-2 h-4 w-4" />
              清空结果
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result?.warnings && result.warnings.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {result.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {hasResults && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">检测结果</CardTitle>
              <div className="flex items-center gap-2">
                <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  {passed}/{result?.summary?.total ?? 0} 通过
                </div>
                {failed > 0 && (
                  <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                    {failed} 不通过
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-[320px] overflow-y-auto pt-2">
            {items.map((item: VehicleEntranceResult) => {
              const id = item.object_id ? String(item.object_id) : `idx-${item.index}`;
              const isSelected = selectedEntranceId === id;
              return (
                <div
                  key={id}
                  role="button"
                  onClick={() => setSelectedEntranceId(isSelected ? null : id)}
                  data-entrance-id={id}
                  className={`border rounded-lg p-3 transition-all cursor-pointer ${
                    item.status === "pass"
                      ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30"
                      : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
                  } ${isSelected ? "ring-2 ring-emerald-400" : ""}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-3 w-3 rounded-sm ${
                          item.status === "pass" ? "bg-emerald-500" : "bg-red-500"
                        }`}
                      />
                      <span className="text-xs font-medium">
                        {item.status === "pass" ? "通过" : "不通过"}
                      </span>
                    </div>
                  </div>
                  {item.status === "fail" && (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {item.reasons.map((reason) => {
                        const label = reasonLabels[reason] || reason;
                        const distanceValue =
                          reason === "too_close_main_intersection"
                            ? item.distances.main
                            : reason === "too_close_secondary_intersection"
                              ? item.distances.secondary
                              : item.distances.branch;
                        const threshold =
                          reason === "too_close_main_intersection"
                            ? minMainDistance
                            : reason === "too_close_secondary_intersection"
                              ? minSecondaryDistance
                              : minBranchDistance;
                        const distanceText =
                          typeof distanceValue === "number"
                            ? `${distanceValue.toFixed(1)}m < ${threshold}m`
                            : `(< ${threshold}m)`;
                        return (
                          <div key={reason} className="flex justify-between items-center">
                            <span>{label}</span>
                            <span className="font-medium">{distanceText}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
