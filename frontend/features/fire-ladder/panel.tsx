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
import { checkFireLadder } from "./api";
import { useFireLadderStore } from "./store";

const DEFAULT_LAYERS = {
  building: "模型_建筑体块",
  fireLadder: "模型_消防登高面",
  redline: "限制_建筑红线",
  plot: "场景_地块",
};

const reasonLabels: Record<string, string> = {
  no_buildings: "无建筑无需检测",
  missing_ladder: "缺少消防登高面",
  outside_redline: "登高面超出红线",
  width_too_small: "登高面宽度不足",
  length_sum_too_short: "登高面长度总和不足",
  distance_out_of_range: "登高面距建筑不在5-10m",
};

export function FireLadderPanel() {
  const apiBase = normalizeApiBase(API_BASE);
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);

  const results = useFireLadderStore((state) => state.results);
  const warnings = useFireLadderStore((state) => state.warnings);
  const showLabels = useFireLadderStore((state) => state.showLabels);
  const setResults = useFireLadderStore((state) => state.setResults);
  const setWarnings = useFireLadderStore((state) => state.setWarnings);
  const setShowLabels = useFireLadderStore((state) => state.setShowLabels);

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

      const data = await checkFireLadder({
        model_path: resolvedModelPath,
        building_layer: DEFAULT_LAYERS.building,
        fire_ladder_layer: DEFAULT_LAYERS.fireLadder,
        redline_layer: DEFAULT_LAYERS.redline,
        plot_layer: DEFAULT_LAYERS.plot,
        min_width: 10,
        min_distance: 5,
        max_distance: 10,
        length_ratio: 0.25,
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
              <div className="p-2 rounded-lg bg-white dark:bg-gray-800 shadow-sm">
                <Eye className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <Label className="text-sm font-medium cursor-pointer">显示检测标记</Label>
                <p className="text-xs text-muted-foreground">
                  {results.length ? `${results.length} 个红线结果` : "暂无检测结果"}
                </p>
              </div>
            </div>
            <Switch
              checked={showLabels}
              disabled={!results.length}
              onCheckedChange={(checked) => setShowLabels(checked)}
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

      {hasResults && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">检测结果</CardTitle>
              <div className="flex items-center gap-2">
                <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  {passedCount}/{results.length} 通过
                </div>
                {failedCount > 0 && (
                  <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                    {failedCount} 未通过
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-[320px] overflow-y-auto pt-2">
            {results.map((item) => (
              <div
                key={item.redline_index}
                className={`border rounded-lg p-3 transition-all hover:shadow-sm ${
                  item.status === "pass"
                    ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30"
                    : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{item.redline_name}</span>
                  {item.status === "pass" ? (
                    <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">通过</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">未通过</span>
                    </div>
                  )}
                </div>
                <div className="space-y-1 text-xs">
                  {item.reasons.length === 0 && (
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-muted-foreground">结论:</span>
                      <span className="font-medium">符合要求</span>
                    </div>
                  )}
                  {item.reasons.map((reason) => (
                    <div key={reason} className="flex justify-between items-center py-0.5">
                      <span className="text-muted-foreground">原因:</span>
                      <span className="font-medium">{reasonLabels[reason] || reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
