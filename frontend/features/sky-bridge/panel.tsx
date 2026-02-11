"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertCircle, CheckCircle2, Loader2, X, Eye } from "lucide-react";
import { useModelStore } from "@/lib/stores/model-store";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";
import { checkSkyBridge } from "./api";
import { useSkyBridgeStore } from "./store";

const DEFAULT_LAYERS = {
  corridor: "模型_空中连廊",
  plot: "场景_地块",
};

const reasonLabels: Record<string, string> = {
  plot_missing: "地块缺失",
  missing_corridor: "缺少空中连廊",
  not_connecting: "未跨越两地块",
  not_closed: "连廊未闭合",
  clearance_too_low: "标高不足",
  width_too_small: "净宽不足",
  height_too_small: "净高不足",
};

export function SkyBridgePanel() {
  const apiBase = normalizeApiBase(API_BASE);
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);

  const results = useSkyBridgeStore((state) => state.results);
  const warnings = useSkyBridgeStore((state) => state.warnings);
  const showLabels = useSkyBridgeStore((state) => state.showLabels);
  const setResults = useSkyBridgeStore((state) => state.setResults);
  const setWarnings = useSkyBridgeStore((state) => state.setWarnings);
  const setShowLabels = useSkyBridgeStore((state) => state.setShowLabels);

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

      const data = await checkSkyBridge({
        model_path: resolvedModelPath,
        corridor_layer: DEFAULT_LAYERS.corridor,
        plot_layer: DEFAULT_LAYERS.plot,
        min_width: 4,
        min_height: 2.2,
        min_clearance: 5,
      });

      setResults(data.results || []);
      setWarnings(data.warnings || []);
      setShowLabels(true);
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
    setShowLabels(false);
    setError(null);
  };

  const hasResults = results.length > 0 || warnings.length > 0;
  const passedCount = results.filter((item) => item.status === "pass").length;
  const failedCount = results.filter((item) => item.status === "fail").length;

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
              <Eye className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <Label htmlFor="show-labels" className="text-sm font-medium cursor-pointer">
                显示检测标签
              </Label>
            </div>
            <Switch
              id="show-labels"
              checked={showLabels}
              onCheckedChange={setShowLabels}
              disabled={!hasResults}
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
            <CardTitle className="text-sm">开始检测</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-1 space-y-3">
          <div className="flex gap-2">
            <Button
              onClick={handleStartCheck}
              disabled={isChecking || !modelFile}
              className="flex-1"
              size="sm"
            >
              {isChecking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  检测中...
                </>
              ) : (
                "开始检测"
              )}
            </Button>
            {hasResults && (
              <Button onClick={handleClearResults} variant="outline" size="sm">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {hasResults && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 p-2 rounded-lg border bg-green-50 dark:bg-green-950">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <div>
                    <div className="text-xs text-muted-foreground">通过</div>
                    <div className="text-lg font-semibold text-green-600 dark:text-green-400">
                      {passedCount}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg border bg-red-50 dark:bg-red-950">
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <div>
                    <div className="text-xs text-muted-foreground">不通过</div>
                    <div className="text-lg font-semibold text-red-600 dark:text-red-400">
                      {failedCount}
                    </div>
                  </div>
                </div>
              </div>

              {warnings.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {warnings.map((warning, i) => (
                      <div key={i}>{warning}</div>
                    ))}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card className="gap-0">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">检测结果详情</CardTitle>
          </CardHeader>
          <CardContent className="pt-1">
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {results.map((result, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg border ${
                    result.status === "pass"
                      ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800"
                      : "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="font-medium text-sm">
                      {result.plot_a} ↔ {result.plot_b}
                    </div>
                    {result.status === "pass" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                    )}
                  </div>
                  {result.status === "fail" && result.reasons.length > 0 && (
                    <div className="space-y-1">
                      {result.reasons.map((reason, i) => (
                        <div key={i} className="text-xs text-muted-foreground">
                          • {reasonLabels[reason] || reason}
                        </div>
                      ))}
                    </div>
                  )}
                  {result.corridors.length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      连廊数量: {result.corridors.length}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
