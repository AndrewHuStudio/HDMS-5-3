"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Loader2, Eye, X } from "lucide-react";
import type { HeightCheckSetbackVolume } from "@/lib/height-check-types";

interface HeightCheckPanelPureProps {
  modelFilePath: string | null;
  modelFile?: File | null;
  onModelPathResolved?: (modelPath: string) => void;
  onCheckResultsChange?: (results: BuildingResult[]) => void;
  results?: BuildingResult[];
  warnings?: string[];
  onVolumesChange?: (volumes: HeightCheckSetbackVolume[]) => void;
  volumes?: HeightCheckSetbackVolume[];
  showSetbackVolumes?: boolean;
  onShowSetbackVolumesChange?: (show: boolean) => void;
  showHeightCheckLabels?: boolean;
  onShowHeightCheckLabelsChange?: (show: boolean) => void;
  onWarningsChange?: (warnings: string[]) => void;
}

// 建筑检测结果类型
export interface BuildingResult {
  building_index: number;
  plot_name: string;
  building_name?: string;
  layer_index?: number;
  layer_name?: string;
  height_limit: number;
  actual_height: number;
  is_exceeded: boolean;
  exceed_amount: number;
}

// 图层信息类型
export function HeightCheckPanelPure({
  modelFilePath,
  modelFile,
  onModelPathResolved,
  onCheckResultsChange,
  results: resultsProp,
  warnings: warningsProp,
  onVolumesChange,
  volumes: volumesProp,
  showSetbackVolumes,
  onShowSetbackVolumesChange,
  showHeightCheckLabels,
  onShowHeightCheckLabelsChange,
  onWarningsChange,
}: HeightCheckPanelPureProps) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
  const [isChecking, setIsChecking] = useState(false);
  const [localResults, setLocalResults] = useState<BuildingResult[]>([]);
  const [localWarnings, setLocalWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const buildingLayer = "模型_建筑体块";
  const setbackLayer = "限制_建筑退线";
  const plotLayer = "场景_地块";
  const [localSetbackVolumes, setLocalSetbackVolumes] = useState<HeightCheckSetbackVolume[]>([]);
  const [localShowVolumes, setLocalShowVolumes] = useState(true);
  const [localShowLabels, setLocalShowLabels] = useState(true);
  const [uploadedModelPath, setUploadedModelPath] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const buildingResults = resultsProp ?? localResults;
  const warnings = warningsProp ?? localWarnings;
  const setbackVolumes = volumesProp ?? localSetbackVolumes;

  const effectiveModelPath =
    modelFilePath || (modelFile?.name === uploadedFileName ? uploadedModelPath : null);
  useEffect(() => {
    setUploadedModelPath(null);
    setUploadedFileName(null);
  }, [modelFile]);

  const setBuildingResults = (results: BuildingResult[]) => {
    if (onCheckResultsChange) {
      onCheckResultsChange(results);
    }
    if (resultsProp === undefined) {
      setLocalResults(results);
    }
  };

  const setWarnings = (nextWarnings: string[]) => {
    if (onWarningsChange) {
      onWarningsChange(nextWarnings);
    }
    if (warningsProp === undefined) {
      setLocalWarnings(nextWarnings);
    }
  };

  const setSetbackVolumes = (volumes: HeightCheckSetbackVolume[]) => {
    if (onVolumesChange) {
      onVolumesChange(volumes);
    }
    if (volumesProp === undefined) {
      setLocalSetbackVolumes(volumes);
    }
  };

  const showVolumes = showSetbackVolumes ?? localShowVolumes;
  const showLabels = showHeightCheckLabels ?? localShowLabels;
  const exceededVolumeCount = setbackVolumes.filter((volume) => volume.is_exceeded).length;
  const buildingCount = buildingResults.length;
  const hasResults =
    buildingResults.length > 0 || warnings.length > 0 || setbackVolumes.length > 0;

  const handleStartCheck = async () => {
    try {
      setIsChecking(true);
      setError(null);

      let resolvedModelPath = effectiveModelPath;
      if (!resolvedModelPath) {
        if (!modelFile) {
          setError("请先上传3dm模型文件");
          return;
        }

        const formData = new FormData();
        formData.append("file", modelFile);

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
          onModelPathResolved?.(resolvedModelPath);
        }
      }

      if (!resolvedModelPath) {
        setError("模型路径无效，请重新上传");
        return;
      }

      console.log("[DEBUG] 开始检测，参数:", {
        model_path: resolvedModelPath,
        building_layer: buildingLayer,
        setback_layer: setbackLayer,
        plot_layer: plotLayer,
      });

      const requestBody = {
        model_path: resolvedModelPath,
        building_layer: buildingLayer,
        setback_layer: setbackLayer,
        plot_layer: plotLayer,
      };
      console.log("[DEBUG] 请求体:", JSON.stringify(requestBody, null, 2));

      const response = await fetch(`${apiBase}/height-check/pure-python`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(requestBody),
      });

      console.log("[DEBUG] 响应状态:", response.status, response.statusText);

      if (!response.ok) {
        const errorData = await response.json();
        console.error("[DEBUG] 检测失败:", errorData);
        throw new Error(errorData.detail || "检测失败");
      }

      const result = await response.json();
      console.log("[DEBUG] 检测结果:", result);
      console.log("[DEBUG] buildings数量:", result.buildings?.length);
      const rawSetbackVolumes = result.setback_volumes ?? result.setbackVolumes ?? [];
      const setbackVolumeList = Array.isArray(rawSetbackVolumes) ? rawSetbackVolumes : [];
      console.log("[DEBUG] setback_volumes数量:", setbackVolumeList.length);

      // 设置结果
      setBuildingResults(result.buildings || []);
      setWarnings(result.warnings || []);
      console.log("准备设置volumes:", setbackVolumeList);
      setSetbackVolumes(setbackVolumeList);
      console.log("volumes设置完成");

      // 同步显示检测结果
      if (onShowSetbackVolumesChange) {
        onShowSetbackVolumesChange(true);
      } else {
        setLocalShowVolumes(true);
      }

      if (onShowHeightCheckLabelsChange) {
        onShowHeightCheckLabelsChange(true);
      } else {
        setLocalShowLabels(true);
      }
    } catch (error) {
      console.error("检测失败:", error);
      if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
        setError(`无法连接后端服务，请确认后端已启动（${apiBase}）`);
      } else {
        setError(error instanceof Error ? error.message : "未知错误");
      }
    } finally {
      setIsChecking(false);
    }
  };

  const handleClearResults = () => {
    setBuildingResults([]);
    setWarnings([]);
    setSetbackVolumes([]);
    if (onShowSetbackVolumesChange) {
      onShowSetbackVolumesChange(false);
    } else {
      setLocalShowVolumes(false);
    }
    if (onShowHeightCheckLabelsChange) {
      onShowHeightCheckLabelsChange(false);
    } else {
      setLocalShowLabels(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 步骤1: 可视化选项 */}
      <Card className="gap-0">
        <CardHeader className="pb-1">
          <div className="flex items-center gap-1">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              1
            </div>
            <CardTitle className="text-sm">可视化选项</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-1 space-y-2">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white dark:bg-gray-800 shadow-sm">
                <Eye className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <Label className="text-sm font-medium cursor-pointer">显示超限体块</Label>
                <p className="text-xs text-muted-foreground">
                  {exceededVolumeCount > 0 ? `${exceededVolumeCount} 个地块超限` : "暂无超限地块"}
                </p>
              </div>
            </div>
            <Switch
              checked={showVolumes}
              disabled={exceededVolumeCount === 0}
              onCheckedChange={(checked) => {
                if (onShowSetbackVolumesChange) {
                  onShowSetbackVolumesChange(checked);
                } else {
                  setLocalShowVolumes(checked);
                }
              }}
            />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg border bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white dark:bg-gray-800 shadow-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <Label className="text-sm font-medium cursor-pointer">显示检测标记</Label>
                <p className="text-xs text-muted-foreground">
                  {buildingCount > 0 ? `${buildingCount} 个建筑` : "暂无检测结果"}
                </p>
              </div>
            </div>
            <Switch
              checked={showLabels}
              disabled={buildingCount === 0}
              onCheckedChange={(checked) => {
                if (onShowHeightCheckLabelsChange) {
                  onShowHeightCheckLabelsChange(checked);
                } else {
                  setLocalShowLabels(checked);
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* 错误提示 */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            <p className="font-medium">检测失败</p>
            <p className="text-xs mt-1">{error}</p>
          </AlertDescription>
        </Alert>
      )}

      {/* 步骤2: 开始检测 */}
      <Card className="gap-0">
        <CardHeader className="pb-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                2
              </div>
              <CardTitle className="text-sm">开始检测</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!hasResults}
              onClick={handleClearResults}
              aria-label="关闭检测结果"
              title="关闭检测结果"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          <Button
            size="lg"
            className="w-full"
            onClick={handleStartCheck}
            disabled={(!modelFilePath && !modelFile) || isChecking}
          >
            {isChecking ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                检测中...
              </>
            ) : (
              "开始检测"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* 检测结果列表 */}
      {buildingResults.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">检测结果</CardTitle>
              <div className="flex items-center gap-2">
                <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  {buildingResults.filter(b => !b.is_exceeded).length}/{buildingResults.length} 合规
                </div>
                {buildingResults.some(b => b.is_exceeded) && (
                  <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                    {buildingResults.filter(b => b.is_exceeded).length} 超限
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-[400px] overflow-y-auto pt-2">
            {buildingResults.map((building) => (
              <div
                key={building.building_index}
                className={`border rounded-lg p-3 transition-all hover:shadow-sm ${
                  building.is_exceeded
                    ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
                    : "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">
                    {building.building_name || `建筑 ${building.building_index + 1}`}
                  </span>
                  {building.is_exceeded ? (
                    <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">超出限高</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">符合限高</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-muted-foreground">所属地块:</span>
                    <span className="font-medium">{building.plot_name}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-muted-foreground">限高标准:</span>
                    <span className="font-medium">{building.height_limit.toFixed(2)} m</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-muted-foreground">实际高度:</span>
                    <span className={`font-medium ${
                      building.is_exceeded ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"
                    }`}>
                      {building.actual_height.toFixed(2)} m
                    </span>
                  </div>
                  {building.is_exceeded && (
                    <div className="flex justify-between items-center pt-1.5 mt-1.5 border-t border-border">
                      <span className="text-red-600 dark:text-red-400 font-medium">超出:</span>
                      <span className="text-red-700 dark:text-red-300 font-bold">
                        +{building.exceed_amount.toFixed(2)} m
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 警告信息 */}
      {warnings.length > 0 && (
        <Alert className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">警告:</p>
            {warnings.map((warning, index) => (
              <p key={index} className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
