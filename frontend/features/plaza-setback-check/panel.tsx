/**
 * 广场退线检测面板
 * 配置忽略高度参数，调用后端检测接口，展示各广场退线区域的建筑侵入合规状态。
 * 点击结果条目可在 3D 场景中高亮对应区域。
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
import { sortReviewItems } from "@/lib/review-result-sort";
import { useTransientHighlight } from "@/lib/use-transient-highlight";
import { buildSetbackAreaViewItems } from "@/features/setback-area/result-view";
import { checkPlazaSetback } from "./api";
import { usePlazaSetbackStore } from "./store";
import type { PlazaSetbackAreaResult } from "./types";

const DEFAULT_LAYERS = {
  plaza: "场地_广场退线",
  building: "模型_建筑体块",
  plot: "场景_地块",
};

export function PlazaSetbackPanel() {
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);

  const result = usePlazaSetbackStore((state) => state.result);
  const showHighlights = usePlazaSetbackStore((state) => state.showHighlights);
  const selectedAreaId = usePlazaSetbackStore((state) => state.selectedAreaId);
  const setResult = usePlazaSetbackStore((state) => state.setResult);
  const setShowHighlights = usePlazaSetbackStore((state) => state.setShowHighlights);
  const setSelectedAreaId = usePlazaSetbackStore((state) => state.setSelectedAreaId);

  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ignoreHeight, setIgnoreHeight] = useState(2);
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

      const data = await checkPlazaSetback({
        model_path: resolvedModelPath,
        plaza_setback_layer: DEFAULT_LAYERS.plaza,
        building_layer: DEFAULT_LAYERS.building,
        plot_layer: DEFAULT_LAYERS.plot,
        ignore_height: ignoreHeight,
      });

      setResult(data);
      setShowHighlights(true);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes("Failed to fetch")) {
        const apiBase = await resolveApiBase({ forceRefresh: true });
        setError(
          `无法连接后端服务，请确认后端已启动（${apiBase}）`
        );
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
    setSelectedAreaId(null);
  };

  const hasResults = Boolean(result);
  const highlightedAreaId = useTransientHighlight(selectedAreaId);
  const violations = result?.summary?.violations ?? 0;
  const compliant = result?.summary?.compliant ?? 0;
  const sortedAreaResults = useMemo(() => {
    const normalizeText = (value?: string | null) => {
      if (typeof value !== "string") return null;
      const text = value.trim();
      return text ? text : null;
    };
    const areaPlotMap = new Map<string, string>();
    (result?.results ?? []).forEach((building) => {
      const areaName = normalizeText(building.plaza_name);
      const plotName = normalizeText(building.plot_name);
      if (!areaName || !plotName || areaPlotMap.has(areaName)) return;
      areaPlotMap.set(areaName, plotName);
    });
    const shapeAreaPlotMap = new Map<string, string>();
    (result?.plaza_areas ?? []).forEach((area) => {
      const areaName = normalizeText(area.name);
      const plotName = normalizeText(area.plot_name);
      if (!areaName || !plotName || shapeAreaPlotMap.has(areaName)) return;
      shapeAreaPlotMap.set(areaName, plotName);
    });

    const viewItems = buildSetbackAreaViewItems(result?.area_results ?? [], "plaza").map((item) => {
      const areaName = normalizeText(item.name) ?? item.displayName;
      const plotName =
        normalizeText(item.plot_name) ??
        shapeAreaPlotMap.get(areaName) ??
        areaPlotMap.get(areaName) ??
        null;
      return {
        ...item,
        areaName,
        plotName,
      };
    });

    return sortReviewItems(viewItems, {
      getStatus: (item) => (item.status === "pass" ? "pass" : "fail"),
      getIndexHint: (item) => item.displayName,
      getName: (item) => item.displayName,
    });
  }, [result]);


  useEffect(() => {
    if (!selectedAreaId) return;
    const element = document.querySelector(
      `[data-plaza-area-id="${selectedAreaId}"]`
    ) as HTMLElement | null;
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedAreaId]);

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
                  {hasResults ? `${violations} 个不合规` : "暂无检测结果"}
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
          <div className="space-y-2">
            <Label htmlFor="plaza-ignore-height">忽略构筑物高度(m)</Label>
            <Input
              id="plaza-ignore-height"
              type="number"
              value={ignoreHeight}
              min={0}
              step={0.1}
              onChange={(e) => setIgnoreHeight(Number(e.target.value))}
            />
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
        <Card className="max-h-[800px] flex flex-col">
          <CardHeader className="pb-1 flex-shrink-0">
            <CardTitle className="text-sm">检测结果</CardTitle>
            <p className="text-xs text-muted-foreground">
              通过 {compliant}，不合规 {violations}
            </p>
          </CardHeader>
          <CardContent className="space-y-2 flex-1 overflow-y-auto review-result-scrollbar">
            {sortedAreaResults.map((item: PlazaSetbackAreaResult & { selectionId: string; displayName: string; areaName: string; plotName: string | null }) => (
              <div
                key={item.selectionId}
                role="button"
                onClick={() =>
                  setSelectedAreaId(selectedAreaId === item.selectionId ? null : item.selectionId)
                }
                data-plaza-area-id={item.selectionId}
                className={`rounded border p-3 text-sm cursor-pointer transition ${
                  item.status === "fail"
                    ? "border-red-200 bg-red-50/80"
                    : "border-green-200 bg-green-50/80"
                } ${selectedAreaId === item.selectionId ? "ring-2 ring-emerald-400" : ""} ${
                  highlightedAreaId === item.selectionId ? "ring-2 ring-amber-400" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">{item.areaName}</div>
                  <div className="text-xs">
                    {item.status === "fail" ? "不合规" : "合规"}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  所属地块：<span className="font-medium text-foreground">{item.plotName ?? "未匹配地块"}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
