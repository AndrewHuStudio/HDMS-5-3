"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, Link2, Loader2, Plus, X } from "lucide-react";
import * as THREE from "three";
import { PlanViewport } from "@/components/city-scene";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useModelStore } from "@/lib/stores/model-store";
import { checkSkyBridge, prepareSkyBridge } from "./api";
import { SkyBridgePlanOverlay } from "./plan-overlay";
import { useSkyBridgeStore } from "./store";
import type { SkyBridgeResult } from "./types";
import { deriveConnectionReasons } from "./utils";

const DEFAULT_LAYERS = {
  plot: "场景_地块",
  corridor: "模型_空中连廊",
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

const warningLabels: Record<string, string> = {
  no_connections: "无需检测：未发现需要连接的地块",
};

const normalizePair = (a: string, b: string) => (a <= b ? [a, b] : [b, a]);

export function SkyBridgePanel() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
  const externalModelUrl = useModelStore((state) => state.externalModelUrl);
  const externalModelType = useModelStore((state) => state.externalModelType);
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const modelBounds = useModelStore((state) => state.modelBounds);
  const modelTransform = useModelStore((state) => state.modelTransform);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);
  const setModelError = useModelStore((state) => state.setModelError);

  const plots = useSkyBridgeStore((state) => state.plots);
  const autoConnections = useSkyBridgeStore((state) => state.autoConnections);
  const connections = useSkyBridgeStore((state) => state.connections);
  const selectedPlot = useSkyBridgeStore((state) => state.selectedPlot);
  const elevation = useSkyBridgeStore((state) => state.elevation);
  const minWidth = useSkyBridgeStore((state) => state.minWidth);
  const minHeight = useSkyBridgeStore((state) => state.minHeight);
  const results = useSkyBridgeStore((state) => state.results);
  const warnings = useSkyBridgeStore((state) => state.warnings);
  const showLabels = useSkyBridgeStore((state) => state.showLabels);
  const setPlots = useSkyBridgeStore((state) => state.setPlots);
  const setAutoConnections = useSkyBridgeStore((state) => state.setAutoConnections);
  const setConnections = useSkyBridgeStore((state) => state.setConnections);
  const toggleConnection = useSkyBridgeStore((state) => state.toggleConnection);
  const setSelectedPlot = useSkyBridgeStore((state) => state.setSelectedPlot);
  const setElevation = useSkyBridgeStore((state) => state.setElevation);
  const setMinWidth = useSkyBridgeStore((state) => state.setMinWidth);
  const setMinHeight = useSkyBridgeStore((state) => state.setMinHeight);
  const setResults = useSkyBridgeStore((state) => state.setResults);
  const setWarnings = useSkyBridgeStore((state) => state.setWarnings);
  const setShowLabels = useSkyBridgeStore((state) => state.setShowLabels);

  const [isPreparing, setIsPreparing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedModelPath, setUploadedModelPath] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const effectiveModelPath =
    modelFilePath || (modelFile?.name === uploadedFileName ? uploadedModelPath : null);

  const viewportBounds = useMemo(() => {
    if (!modelBounds) return null;
    return new THREE.Box3(
      new THREE.Vector3(modelBounds.min[0], modelBounds.min[1], modelBounds.min[2]),
      new THREE.Vector3(modelBounds.max[0], modelBounds.max[1], modelBounds.max[2])
    );
  }, [modelBounds]);

  useEffect(() => {
    setUploadedModelPath(null);
    setUploadedFileName(null);
  }, [modelFile]);

  const handlePlotClick = (name: string) => {
    if (!selectedPlot) {
      setSelectedPlot(name);
      return;
    }

    if (selectedPlot === name) {
      setSelectedPlot(null);
      return;
    }

    const [a, b] = normalizePair(selectedPlot, name);
    toggleConnection(a, b);
    setSelectedPlot(null);
  };

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

  const handlePrepare = async () => {
    try {
      setIsPreparing(true);
      setError(null);

      const resolvedModelPath = await resolveModelPath();
      if (!resolvedModelPath) return;

      const data = await prepareSkyBridge({
        model_path: resolvedModelPath,
        plot_layer: DEFAULT_LAYERS.plot,
        corridor_layer: DEFAULT_LAYERS.corridor,
        plot_name_key: "地块名称",
        connection_key: "空中连接地块",
      });

      setPlots(data.plots || []);
      setAutoConnections(data.connections || []);
      setConnections(data.connections || []);
      setWarnings(data.warnings || []);
      setResults([]);
      setSelectedPlot(null);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes("Failed to fetch")) {
        setError(`无法连接后端服务，请确认后端已启动（${apiBase}）`);
      } else {
        setError(err instanceof Error ? err.message : "未知错误");
      }
    } finally {
      setIsPreparing(false);
    }
  };

  const handleStartCheck = async () => {
    try {
      setIsChecking(true);
      setError(null);

      const resolvedModelPath = await resolveModelPath();
      if (!resolvedModelPath) return;

      const connectionPairs = connections.map(
        (conn) => normalizePair(conn.from, conn.to) as [string, string]
      );

      const data = await checkSkyBridge({
        model_path: resolvedModelPath,
        plot_layer: DEFAULT_LAYERS.plot,
        corridor_layer: DEFAULT_LAYERS.corridor,
        plot_name_key: "地块名称",
        connection_key: "空中连接地块",
        elevation,
        min_width: minWidth,
        min_height: minHeight,
        connections: connectionPairs,
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
          <div className="flex items-center justify-between p-3 rounded-lg border bg-gradient-to-r from-sky-50 to-indigo-50 dark:from-sky-950 dark:to-indigo-950">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white dark:bg-gray-800 shadow-sm">
                <Eye className="h-4 w-4 text-sky-600" />
              </div>
              <div>
                <Label className="text-sm font-medium cursor-pointer">显示检测标记</Label>
                <p className="text-xs text-muted-foreground">
                  {results.length ? `${results.length} 条连接结果` : "暂无检测结果"}
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
            <CardTitle className="text-sm">模型平面图</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-1">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handlePrepare} disabled={isPreparing}>
              {isPreparing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  读取中...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  读取模型连接信息
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setConnections(autoConnections);
                setSelectedPlot(null);
              }}
              disabled={isPreparing || autoConnections.length === 0}
            >
              恢复自动连接
            </Button>
          </div>

          <PlanViewport
            modelBounds={viewportBounds}
            externalModelUrl={externalModelUrl}
            externalModelType={externalModelType}
            modelTransform={modelTransform}
            onModelError={setModelError}
            withCard={false}
            sceneUpAxis="z"
            visibleLayerPrefixes={["场景"]}
            overlayContent={
              <SkyBridgePlanOverlay
                plots={plots}
                connections={connections}
                selectedPlot={selectedPlot}
                modelTransform={modelTransform}
                onPlotClick={handlePlotClick}
              />
            }
            footerContent={
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Link2 className="h-3 w-3" />
                点击两个地块可新增/取消连接
              </div>
            }
          />
        </CardContent>
      </Card>

      <Card className="gap-0">
        <CardHeader className="pb-1">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              3
            </div>
            <CardTitle className="text-sm">配置参数</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3 pt-1">
          <div className="space-y-1">
            <Label htmlFor="sky-bridge-elevation">标高 (m)</Label>
            <Input
              id="sky-bridge-elevation"
              type="number"
              value={elevation}
              min={0}
              step={0.1}
              onChange={(e) => setElevation(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sky-bridge-width">净宽 (m)</Label>
            <Input
              id="sky-bridge-width"
              type="number"
              value={minWidth}
              min={0}
              step={0.1}
              onChange={(e) => setMinWidth(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sky-bridge-height">净高 (m)</Label>
            <Input
              id="sky-bridge-height"
              type="number"
              value={minHeight}
              min={0}
              step={0.1}
              onChange={(e) => setMinHeight(Number(e.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0">
        <CardHeader className="pb-1">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              4
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

      {warnings.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {warnings.map((warning) => (
              <div key={warning}>{warningLabels[warning] || warning}</div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {hasResults && (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">检测结果</CardTitle>
            <p className="text-xs text-muted-foreground">
              通过 {passedCount}，未通过 {failedCount}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {results.map((item: SkyBridgeResult) => {
              const derivedReasons = deriveConnectionReasons(item);
              return (
                <div
                  key={`${item.plot_a}-${item.plot_b}`}
                  className={`rounded border p-3 text-sm ${
                    item.status === "pass"
                      ? "border-green-200 bg-green-50/80"
                      : "border-red-200 bg-red-50/80"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {item.plot_a} ↔ {item.plot_b}
                    </div>
                    <div className="text-xs">{item.status === "pass" ? "通过" : "未通过"}</div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 space-y-1">
                    {derivedReasons.length === 0 ? (
                      <div>{item.status === "pass" ? "符合要求" : "未通过"}</div>
                    ) : (
                      derivedReasons.map((reason) => (
                        <div key={reason}>{reasonLabels[reason] || reason}</div>
                      ))
                    )}
                  </div>
                  {item.corridors.length > 0 && (
                    <div className="mt-2 space-y-1 text-xs">
                      {item.corridors.map((corridor) => (
                        <div key={corridor.index} className="flex items-center gap-2">
                          <span
                            className={`inline-flex h-2 w-2 rounded-full ${
                              corridor.status === "pass" ? "bg-green-500" : "bg-red-500"
                            }`}
                          />
                          <span>
                            连廊 #{corridor.index + 1}：{corridor.status === "pass" ? "通过" : "未通过"}
                          </span>
                        </div>
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
