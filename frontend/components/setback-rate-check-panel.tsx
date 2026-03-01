"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, Loader2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";
import { sortReviewItems } from "@/lib/review-result-sort";
import type { SetbackCheckResult } from "@/lib/setback-check-types";

interface SetbackRateCheckPanelProps {
  modelFilePath: string | null;
  modelFile?: File | null;
  onModelPathResolved?: (modelPath: string) => void;
  onResultChange?: (result: SetbackCheckResult | null) => void;
  onHighlightTargetChange?: (target: { type: "overall" | "plot" | null; plotName?: string | null }) => void;
  selectedPlotName?: string | null;
  onSelectedPlotNameChange?: (plotName: string | null) => void;
  showSetbackLabels?: boolean;
  onShowSetbackLabelsChange?: (show: boolean) => void;
}

export function SetbackRateCheckPanel({
  modelFilePath,
  modelFile,
  onModelPathResolved,
  onResultChange,
  onHighlightTargetChange,
  selectedPlotName,
  onSelectedPlotNameChange,
  showSetbackLabels,
  onShowSetbackLabelsChange,
}: SetbackRateCheckPanelProps) {
  const apiBase = normalizeApiBase(API_BASE);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SetbackCheckResult | null>(null);
  const [sampleStep, setSampleStep] = useState(1.0);
  const [tolerance, setTolerance] = useState(0.5);
  const [requiredRatePercent, setRequiredRatePercent] = useState(70);
  const [localShowLabels, setLocalShowLabels] = useState(true);
  const [uploadedModelPath, setUploadedModelPath] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const plotRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const buildingLayer = "模型_建筑体块";
  const setbackLayer = "限制_建筑退线";
  const plotLayer = "场景_地块";

  const effectiveModelPath =
    modelFilePath || (modelFile?.name === uploadedFileName ? uploadedModelPath : null);
  const showLabels = showSetbackLabels ?? localShowLabels;

  useEffect(() => {
    setUploadedModelPath(null);
    setUploadedFileName(null);
  }, [modelFile]);

  useEffect(() => {
    if (!selectedPlotName) return;
    const target = plotRefs.current.get(selectedPlotName);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedPlotName]);

  useEffect(() => {
    if (!onHighlightTargetChange) return;
    if (!selectedPlotName) return;
    onHighlightTargetChange({ type: "plot", plotName: selectedPlotName });
  }, [onHighlightTargetChange, selectedPlotName]);

  const resolveModelPath = async () => {
    let resolvedModelPath = effectiveModelPath;
    if (resolvedModelPath) return resolvedModelPath;

    if (!modelFile) {
      setError("请先上传3dm模型文件");
      return null;
    }

    const formData = new FormData();
    formData.append("file", modelFile);

    const uploadUrl = `${apiBase}/models/import?skip_layers=true`;
    const uploadResponse = await fetch(uploadUrl, {
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

    return resolvedModelPath ?? null;
  };

  const handleStartCheck = async () => {
    try {
      setIsChecking(true);
      setError(null);

      const resolvedModelPath = await resolveModelPath();
      if (!resolvedModelPath) return;

      const safeSampleStep = Number.isFinite(sampleStep) && sampleStep > 0 ? sampleStep : 1.0;
      const safeTolerance = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0.5;
      const requiredRate =
        Number.isFinite(requiredRatePercent) && requiredRatePercent >= 0
          ? requiredRatePercent / 100
          : null;

      const response = await fetch(`${apiBase}/setback-rate-check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          model_path: resolvedModelPath,
          building_layer: buildingLayer,
          setback_layer: setbackLayer,
          plot_layer: plotLayer,
          sample_step: safeSampleStep,
          tolerance: safeTolerance,
          required_rate: requiredRate,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "检测失败");
      }

      const data = (await response.json()) as SetbackCheckResult;
      setResult(data);
      onResultChange?.(data);
      if (onShowSetbackLabelsChange) {
        onShowSetbackLabelsChange(true);
      } else {
        setLocalShowLabels(true);
      }
      setError(null);
    } catch (err) {
      console.error("贴线率检测失败:", err);
      if (err instanceof TypeError && err.message.includes("Failed to fetch")) {
        setError(`无法连接后端服务，请确认后端已启动（${apiBase}）。`);
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
    onResultChange?.(null);
    onSelectedPlotNameChange?.(null);
    onHighlightTargetChange?.({ type: null });
    if (onShowSetbackLabelsChange) {
      onShowSetbackLabelsChange(false);
    } else {
      setLocalShowLabels(false);
    }
  };

  const plots = result?.plots ?? [];
  const sortedPlots = useMemo(
    () =>
      sortReviewItems(plots, {
        getStatus: (plot) =>
          plot.is_compliant === true ? "pass" : plot.is_compliant === false ? "fail" : "unknown",
        getIndexHint: (plot) => plot.plot_name,
        getName: (plot) => plot.plot_name,
      }),
    [plots]
  );
  const overallRate = result?.summary?.overall_rate ?? 0;
  const overallRateText = `${(overallRate * 100).toFixed(1)}%`;
  const compliantCount = plots.filter((plot) => plot.is_compliant === true).length;
  const nonCompliantCount = plots.filter((plot) => plot.is_compliant === false).length;

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
                <Label className="text-sm font-medium cursor-pointer">显示贴线率标签</Label>
                <p className="text-xs text-muted-foreground">
                  {plots.length ? `${plots.length} 个地块` : "暂无检测结果"}
                </p>
              </div>
            </div>
            <Switch
              checked={showLabels}
              disabled={!result}
              onCheckedChange={(checked) => {
                if (onShowSetbackLabelsChange) {
                  onShowSetbackLabelsChange(checked);
                } else {
                  setLocalShowLabels(checked);
                }
              }}
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
        <CardContent className="space-y-3 pt-1">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">采样步长 (m)</Label>
              <input
                type="number"
                value={sampleStep}
                min={0.1}
                step={0.1}
                onChange={(e) => setSampleStep(Number(e.target.value))}
                className="w-full px-2 py-2 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">容差 (m)</Label>
              <input
                type="number"
                value={tolerance}
                min={0}
                step={0.1}
                onChange={(e) => setTolerance(Number(e.target.value))}
                className="w-full px-2 py-2 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">要求贴线率 (%)</Label>
              <input
                type="number"
                value={requiredRatePercent}
                min={0}
                max={100}
                step={1}
                onChange={(e) => setRequiredRatePercent(Number(e.target.value))}
                className="w-full px-2 py-2 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
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
                3
              </div>
              <CardTitle className="text-sm">开始检测</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!result}
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

      {result && (
        <Card
          onMouseEnter={() => onHighlightTargetChange?.({ type: "overall" })}
          onMouseLeave={() =>
            onHighlightTargetChange?.(
              selectedPlotName ? { type: "plot", plotName: selectedPlotName } : { type: null }
            )
          }
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">检测结果</CardTitle>
              <div className="flex items-center gap-2">
                <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  {compliantCount}/{plots.length} 合规
                </div>
                {nonCompliantCount > 0 && (
                  <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                    {nonCompliantCount} 不合规
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>总体贴线率</span>
              <span className="font-medium">{overallRateText}</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>退线总长度</span>
                <span>{result.summary.total_setback_length.toFixed(1)} m</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>贴线总长度</span>
                <span>{result.summary.total_overlap_length.toFixed(1)} m</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>未匹配建筑</span>
                <span>{result.summary.unmatched_buildings}</span>
              </div>
            </div>

            <div className="space-y-2">
              {sortedPlots.map((plot) => {
                const ratePercent = plot.frontage_rate * 100;
                const required = plot.required_rate ?? null;
                const requiredPercent = required !== null ? required * 100 : null;
                const statusText =
                  plot.is_compliant === null
                    ? "待确认"
                    : plot.is_compliant
                      ? "合规"
                      : "不合规";
                const isSelected = selectedPlotName === plot.plot_name;
                return (
                  <div
                    key={plot.plot_name}
                    className={`border rounded-lg p-3 space-y-2 transition-all hover:shadow-sm ${
                      plot.is_compliant === true
                        ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30"
                        : plot.is_compliant === false
                          ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
                          : "border-border bg-muted/30"
                    } ${isSelected ? "ring-1 ring-blue-400" : ""}`}
                    ref={(node) => {
                      if (!node) return;
                      plotRefs.current.set(plot.plot_name, node);
                    }}
                    onMouseEnter={() =>
                      onHighlightTargetChange?.({ type: "plot", plotName: plot.plot_name })
                    }
                    onMouseLeave={() =>
                      onHighlightTargetChange?.(
                        selectedPlotName ? { type: "plot", plotName: selectedPlotName } : { type: "overall" }
                      )
                    }
                    onClick={() => {
                      const next = isSelected ? null : plot.plot_name;
                      onSelectedPlotNameChange?.(next);
                      onHighlightTargetChange?.(
                        next ? { type: "plot", plotName: next } : { type: "overall" }
                      );
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm font-medium ${
                          plot.is_compliant === true
                            ? "text-green-700 dark:text-green-400"
                            : plot.is_compliant === false
                              ? "text-red-700 dark:text-red-400"
                              : ""
                        }`}
                      >
                        {plot.plot_name}
                      </span>
                      <div
                        className={`flex items-center gap-1 text-xs ${
                          plot.is_compliant === true
                            ? "text-green-700 dark:text-green-400"
                            : plot.is_compliant === false
                              ? "text-red-700 dark:text-red-400"
                              : "text-muted-foreground"
                        }`}
                      >
                        {plot.is_compliant === true ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5" />
                        )}
                        <span className="font-medium">{statusText}</span>
                      </div>
                    </div>
                    <div className="h-2 w-full rounded bg-secondary">
                      <div
                        className={`h-2 rounded ${
                          plot.is_compliant === true
                            ? "bg-green-500"
                            : plot.is_compliant === false
                              ? "bg-red-500"
                              : "bg-muted-foreground/60"
                        }`}
                        style={{ width: `${Math.min(100, ratePercent)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>贴线率</span>
                      <span
                        className={
                          plot.is_compliant === true
                            ? "text-green-700 dark:text-green-400"
                            : plot.is_compliant === false
                              ? "text-red-700 dark:text-red-400"
                              : "text-muted-foreground"
                        }
                      >
                        {ratePercent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>退线长度</span>
                      <span>{plot.setback_length.toFixed(1)} m</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>贴线长度</span>
                      <span>{plot.overlap_length.toFixed(1)} m</span>
                    </div>
                    {requiredPercent !== null && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>要求贴线率</span>
                        <span>{requiredPercent.toFixed(1)}%</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>参与建筑</span>
                      <span>{plot.building_count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
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
