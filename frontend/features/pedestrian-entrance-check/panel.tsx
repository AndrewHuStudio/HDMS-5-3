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
import { checkPedestrianEntrance } from "./api";
import { usePedestrianEntranceStore } from "./store";

const DEFAULT_LAYERS = {
  entrance: "场地_人行出入口",
  redlines: ["限制_建筑红线", "场地_广场退线", "场地_绿地退线"],
};

const summaryReasonLabels: Record<string, string> = {
  insufficient_entrances: "合规出入口数量不足",
};

const itemReasonLabels: Record<string, string> = {
  outside_redline: "不在红线上或红线内",
};

export function PedestrianEntrancePanel() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);

  const result = usePedestrianEntranceStore((state) => state.result);
  const showHighlights = usePedestrianEntranceStore((state) => state.showHighlights);
  const setResult = usePedestrianEntranceStore((state) => state.setResult);
  const setShowHighlights = usePedestrianEntranceStore((state) => state.setShowHighlights);

  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onCurveTolerance, setOnCurveTolerance] = useState(1);
  const [minRequiredCount, setMinRequiredCount] = useState(2);
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

      const data = await checkPedestrianEntrance({
        model_path: resolvedModelPath,
        entrance_layer: DEFAULT_LAYERS.entrance,
        redline_layers: DEFAULT_LAYERS.redlines,
        on_curve_tolerance: onCurveTolerance,
        min_required_count: minRequiredCount,
      });

      setResult(data);
      setShowHighlights(true);
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
    setResult(null);
    setError(null);
    setShowHighlights(false);
  };

  const hasResults = Boolean(result);
  const passed = result?.summary?.passed ?? 0;
  const failed = result?.summary?.failed ?? 0;
  const requiredMin = result?.summary?.required_min ?? minRequiredCount;
  const overallStatus = result?.summary?.status ?? "fail";
  const summaryReasons = result?.summary?.reasons ?? [];
  const items = useMemo(() => result?.results ?? [], [result]);

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
                <Label className="text-sm font-medium cursor-pointer">显示红线结果</Label>
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
              <Label htmlFor="pedestrian-on-tolerance">红线距离阈值 (m)</Label>
              <Input
                id="pedestrian-on-tolerance"
                type="number"
                min={0}
                step={0.1}
                value={onCurveTolerance}
                onChange={(e) => setOnCurveTolerance(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pedestrian-min-required">最少合规出入口数量</Label>
              <Input
                id="pedestrian-min-required"
                type="number"
                min={1}
                step={1}
                value={minRequiredCount}
                onChange={(e) => setMinRequiredCount(Number(e.target.value))}
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

      {hasResults && overallStatus === "fail" && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            合规出入口数量不足（{passed}/{requiredMin}）。
          </AlertDescription>
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
                  {passed}/{result?.summary?.total ?? 0} 合规
                </div>
                {failed > 0 && (
                  <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                    {failed} 不合规
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-[320px] overflow-y-auto pt-2">
            {overallStatus === "fail" && summaryReasons.length > 0 && (
              <div className="space-y-1 text-xs text-muted-foreground">
                {summaryReasons.map((reason) => (
                  <div key={reason}>{summaryReasonLabels[reason] || reason}</div>
                ))}
              </div>
            )}
            {items.map((item) => {
              const isFail = item.status === "fail";
              return (
                <div
                  key={`${item.object_id ?? item.index}`}
                  className={`border rounded-lg p-3 transition-all ${
                    isFail
                      ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
                      : "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className={`h-3 w-3 rounded-sm ${
                        isFail ? "bg-red-500" : "bg-emerald-500"
                      }`}
                    />
                    <span className="text-xs font-medium">
                      {isFail ? "不通过" : "通过"}
                    </span>
                  </div>
                  {isFail && (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {item.reasons.map((reason) => (
                        <div key={reason}>{itemReasonLabels[reason] || reason}</div>
                      ))}
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
