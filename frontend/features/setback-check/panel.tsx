"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, Loader2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useModelStore } from "@/lib/stores/model-store";
import { resolveApiBase } from "@/lib/api-base";
import { sortReviewItems } from "@/lib/review-result-sort";
import { checkSetback } from "./api";
import { useSetbackCheckStore } from "./store";

const DEFAULT_LAYERS = {
  building: "模型_建筑体块",
  setback: "限制_建筑退线",
  plot: "场景_地块",
};

export function SetbackPanel() {
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);

  const result = useSetbackCheckStore((state) => state.result);
  const showHighlights = useSetbackCheckStore((state) => state.showHighlights);
  const selectedBuildingIndex = useSetbackCheckStore((state) => state.selectedBuildingIndex);
  const setResult = useSetbackCheckStore((state) => state.setResult);
  const setShowHighlights = useSetbackCheckStore((state) => state.setShowHighlights);
  const setSelectedBuildingIndex = useSetbackCheckStore((state) => state.setSelectedBuildingIndex);

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

      const data = await checkSetback({
        model_path: resolvedModelPath,
        building_layer: DEFAULT_LAYERS.building,
        setback_layer: DEFAULT_LAYERS.setback,
        plot_layer: DEFAULT_LAYERS.plot,
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
    setSelectedBuildingIndex(null);
  };

  const buildingResults = result?.buildings ?? [];
  const sortedBuildingResults = useMemo(
    () =>
      sortReviewItems(buildingResults, {
        getStatus: (building) => (building.is_exceeded ? "fail" : "pass"),
        getIndexHint: (building) => building.building_index,
        getName: (building) => building.building_name ?? building.plot_name,
      }),
    [buildingResults]
  );
  const exceededCount = buildingResults.filter((b) => b.is_exceeded).length;
  const compliantCount = buildingResults.length - exceededCount;
  const hasResults = buildingResults.length > 0;

  useEffect(() => {
    if (selectedBuildingIndex === null) return;
    const element = document.querySelector(
      `[data-building-index="${selectedBuildingIndex}"]`
    ) as HTMLElement | null;
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedBuildingIndex]);

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
          <div className="flex items-center justify-between p-3 rounded-lg border bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white dark:bg-gray-800 shadow-sm">
                <Eye className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <Label className="text-sm font-medium cursor-pointer">显示超限高亮</Label>
                <p className="text-xs text-muted-foreground">
                  {hasResults ? `${buildingResults.length} 个建筑` : "暂无检测结果"}
                </p>
              </div>
            </div>
            <Switch
              checked={showHighlights}
              disabled={!hasResults}
              onCheckedChange={setShowHighlights}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">{error}</AlertDescription>
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
              aria-label="清除检测结果"
              title="清除检测结果"
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

      {hasResults && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">检测结果</CardTitle>
              <div className="flex items-center gap-2">
                <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  {compliantCount}/{buildingResults.length} 合规
                </div>
                {exceededCount > 0 && (
                  <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                    {exceededCount} 超限
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-2">
            {sortedBuildingResults.map((building) => {
              const isSelected = selectedBuildingIndex === building.building_index;
              return (
                <div
                  key={building.building_index}
                  data-building-index={building.building_index}
                  role="button"
                  onClick={() => setSelectedBuildingIndex(isSelected ? null : building.building_index)}
                  className={`border rounded-lg p-3 transition-all hover:shadow-sm cursor-pointer ${
                    building.is_exceeded
                      ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
                      : "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30"
                  } ${isSelected ? "ring-2 ring-blue-400" : ""}`}
                >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">
                    {building.building_name || `建筑 ${building.building_index + 1}`}
                  </span>
                  {building.is_exceeded ? (
                    <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">超限</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">合规</span>
                    </div>
                  )}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-muted-foreground">所属地块:</span>
                    <span className="font-medium">{building.plot_name ?? "未匹配地块"}</span>
                  </div>
                  {building.is_exceeded && building.reason === "missing_setback" && (
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-muted-foreground">原因:</span>
                      <span className="text-red-600 font-medium">未匹配退线</span>
                    </div>
                  )}
                </div>
              </div>
            );
            })}
          </CardContent>
        </Card>
      )}

      {result?.warnings && result.warnings.length > 0 && (
        <Alert className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">警告:</p>
            {result.warnings.map((warning, index) => (
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
