"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Loader2, Eye, X } from "lucide-react";
import { useModelStore } from "@/lib/stores/model-store";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";
import { checkHeight } from "./api";
import { useHeightCheckStore } from "./store";

const DEFAULT_LAYERS = {
  building: "模型_建筑体块",
  setback: "限制_建筑退线",
  plot: "场景_地块",
};

export function HeightCheckPanel() {
  const apiBase = normalizeApiBase(API_BASE);
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);

  const results = useHeightCheckStore((state) => state.results);
  const warnings = useHeightCheckStore((state) => state.warnings);
  const volumes = useHeightCheckStore((state) => state.volumes);
  const showSetbackVolumes = useHeightCheckStore((state) => state.showSetbackVolumes);
  const showHeightCheckLabels = useHeightCheckStore((state) => state.showHeightCheckLabels);
  const setResults = useHeightCheckStore((state) => state.setResults);
  const setWarnings = useHeightCheckStore((state) => state.setWarnings);
  const setVolumes = useHeightCheckStore((state) => state.setVolumes);
  const setShowSetbackVolumes = useHeightCheckStore((state) => state.setShowSetbackVolumes);
  const setShowHeightCheckLabels = useHeightCheckStore((state) => state.setShowHeightCheckLabels);

  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedModelPath, setUploadedModelPath] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const effectiveModelPath =
    modelFilePath || (modelFile?.name === uploadedFileName ? uploadedModelPath : null);

  useEffect(() => {
    setUploadedModelPath(null);
    setUploadedFileName(null);
  }, [modelFile]);

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

        const uploadUrl = `${apiBase}/models/import?skip_layers=true`;
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          body: formData,
        });

        if (!uploadResponse.ok) {
          if (uploadResponse.status === 404) {
            throw new Error(`模型上传接口未找到: ${uploadUrl}`);
          }
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
      }

      if (!resolvedModelPath) {
        setError("模型路径无效，请重新上传");
        return;
      }

      const result = await checkHeight({
        model_path: resolvedModelPath,
        building_layer: DEFAULT_LAYERS.building,
        setback_layer: DEFAULT_LAYERS.setback,
        plot_layer: DEFAULT_LAYERS.plot,
      });

      setResults(result.buildings || []);
      setWarnings(result.warnings || []);
      const rawVolumes = result.setback_volumes ?? [];
      setVolumes(Array.isArray(rawVolumes) ? rawVolumes : []);
      setShowSetbackVolumes(true);
      setShowHeightCheckLabels(true);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes("Failed to fetch")) {
        setError(`无法连接后端服务，请确认后端已启动（${apiBase}）`);
      } else {
        setError(err instanceof Error ? err.message : "未知错误");
      }
    } finally {
      setIsChecking(false);
    }
  };

  const handleClearResults = () => {
    setResults([]);
    setWarnings([]);
    setVolumes([]);
    setShowSetbackVolumes(false);
    setShowHeightCheckLabels(false);
    setError(null);
  };

  const exceededVolumeCount = volumes.filter((v) => v.is_exceeded).length;
  const buildingCount = results.length;
  const hasResults = results.length > 0 || warnings.length > 0 || volumes.length > 0;

  return (
    <div className="space-y-3">
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
              checked={showSetbackVolumes}
              disabled={exceededVolumeCount === 0}
              onCheckedChange={setShowSetbackVolumes}
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
              checked={showHeightCheckLabels}
              disabled={buildingCount === 0}
              onCheckedChange={setShowHeightCheckLabels}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            <p className="font-medium">检测失败</p>
            <p className="text-xs mt-1">{error}</p>
          </AlertDescription>
        </Alert>
      )}

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

      {results.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">检测结果</CardTitle>
              <div className="flex items-center gap-2">
                <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  {results.filter((b) => !b.is_exceeded).length}/{results.length} 合规
                </div>
                {results.some((b) => b.is_exceeded) && (
                  <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                    {results.filter((b) => b.is_exceeded).length} 超限
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-[400px] overflow-y-auto pt-2">
            {results.map((building) => (
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
                    <span
                      className={`font-medium ${
                        building.is_exceeded
                          ? "text-red-700 dark:text-red-400"
                          : "text-green-700 dark:text-green-400"
                      }`}
                    >
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

      {warnings.length > 0 && (
        <Alert className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">警告:</p>
            {warnings.map((warning, index) => (
              <p key={index} className="text-xs text-amber-600 dark:text-amber-400">
                {warning}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
