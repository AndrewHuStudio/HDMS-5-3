"use client";

import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, Eye, EyeOff, Loader2, Download, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModelStore } from "@/lib/stores/model-store";
import { resolveApiBase, API_BASE, normalizeApiBase } from "@/lib/api-base";
import { toolRegistry } from "@/lib/registries/tool-registry";
import { ExportChecklistDialog } from "@/features/export-checklist/dialog";

// Feature stores
import { useHeightCheckStore } from "@/features/height-check/store";
import { useSetbackCheckStore } from "@/features/setback-check/store";
import { useSightCorridorStore } from "@/features/sight-corridor/store";
import { useFireLadderStore } from "@/features/fire-ladder/store";
import { useSkyBridgeStore } from "@/features/sky-bridge/store";
import { useVehicleEntranceStore } from "@/features/vehicle-entrance-check/store";
import { usePedestrianEntranceStore } from "@/features/pedestrian-entrance-check/store";
import { useGreenSetbackStore } from "@/features/green-setback-check/store";
import { usePlazaSetbackStore } from "@/features/plaza-setback-check/store";
import { useSetbackRateCheckStore } from "@/features/setback-rate-check/store";

// Feature APIs
import { checkHeight } from "@/features/height-check/api";
import { checkSetback } from "@/features/setback-check/api";
import { checkCorridorCollision } from "@/features/sight-corridor/api";
import { checkFireLadder } from "@/features/fire-ladder/api";
import { prepareSkyBridge, checkSkyBridge } from "@/features/sky-bridge/api";
import { checkVehicleEntrance } from "@/features/vehicle-entrance-check/api";
import { checkPedestrianEntrance } from "@/features/pedestrian-entrance-check/api";
import { checkGreenSetback } from "@/features/green-setback-check/api";
import { checkPlazaSetback } from "@/features/plaza-setback-check/api";

// Feature Panels
import { HeightCheckPanel } from "@/features/height-check/panel";
import { SetbackPanel } from "@/features/setback-check/panel";
import { SightCorridorPanelAdapter } from "@/features/sight-corridor/panel";
import { FireLadderPanel } from "@/features/fire-ladder/panel";
import { SkyBridgePanel } from "@/features/sky-bridge/panel";
import { VehicleEntrancePanel } from "@/features/vehicle-entrance-check/panel";
import { PedestrianEntrancePanel } from "@/features/pedestrian-entrance-check/panel";
import { GreenSetbackPanel } from "@/features/green-setback-check/panel";
import { PlazaSetbackPanel } from "@/features/plaza-setback-check/panel";
import { SetbackRatePanel } from "@/features/setback-rate-check/panel";

type FeatureId =
  | "height-check"
  | "setback-check"
  | "sight-corridor"
  | "fire-ladder"
  | "sky-bridge"
  | "vehicle-entrance-check"
  | "pedestrian-entrance-check"
  | "green-setback-check"
  | "plaza-setback-check"
  | "setback-rate-check";

interface FeatureMeta {
  id: FeatureId;
  name: string;
  Panel: React.ComponentType;
}

const FEATURES: FeatureMeta[] = [
  { id: "height-check", name: "限高检测", Panel: HeightCheckPanel },
  { id: "setback-check", name: "退线检测", Panel: SetbackPanel },
  { id: "sight-corridor", name: "视线通廊检测", Panel: SightCorridorPanelAdapter },
  { id: "fire-ladder", name: "消防登高面检测", Panel: FireLadderPanel },
  { id: "sky-bridge", name: "空中连廊检测", Panel: SkyBridgePanel },
  { id: "vehicle-entrance-check", name: "车行出入口检测", Panel: VehicleEntrancePanel },
  { id: "pedestrian-entrance-check", name: "人行出入口检测", Panel: PedestrianEntrancePanel },
  { id: "green-setback-check", name: "绿地退线控制检测", Panel: GreenSetbackPanel },
  { id: "plaza-setback-check", name: "广场退线控制检测", Panel: PlazaSetbackPanel },
  { id: "setback-rate-check", name: "贴线率检测", Panel: SetbackRatePanel },
];

// ---- visibility helpers ----

function useFeatureVisible(id: FeatureId): boolean {
  const heightVisible = useHeightCheckStore((s) => s.showSetbackVolumes || s.showHeightCheckLabels);
  const setbackVisible = useSetbackCheckStore((s) => s.showHighlights);
  const corridorVisible = useSightCorridorStore((s) => s.showCorridorLayer || s.showBlockingLabels);
  const fireLadderVisible = useFireLadderStore((s) => s.showLabels);
  const skyBridgeVisible = useSkyBridgeStore((s) => s.showLabels);
  const vehicleVisible = useVehicleEntranceStore((s) => s.showHighlights);
  const pedestrianVisible = usePedestrianEntranceStore((s) => s.showHighlights);
  const greenVisible = useGreenSetbackStore((s) => s.showHighlights);
  const plazaVisible = usePlazaSetbackStore((s) => s.showHighlights);
  const setbackRateVisible = useSetbackRateCheckStore((s) => s.showSetbackLabels);

  const map: Record<FeatureId, boolean> = {
    "height-check": heightVisible,
    "setback-check": setbackVisible,
    "sight-corridor": corridorVisible,
    "fire-ladder": fireLadderVisible,
    "sky-bridge": skyBridgeVisible,
    "vehicle-entrance-check": vehicleVisible,
    "pedestrian-entrance-check": pedestrianVisible,
    "green-setback-check": greenVisible,
    "plaza-setback-check": plazaVisible,
    "setback-rate-check": setbackRateVisible,
  };
  return map[id];
}

function hideAll() {
  useHeightCheckStore.getState().setShowSetbackVolumes(false);
  useHeightCheckStore.getState().setShowHeightCheckLabels(false);
  useSetbackCheckStore.getState().setShowHighlights(false);
  useSightCorridorStore.getState().setShowCorridorLayer(false);
  useSightCorridorStore.getState().setShowBlockingLabels(false);
  useFireLadderStore.getState().setShowLabels(false);
  useSkyBridgeStore.getState().setShowLabels(false);
  useVehicleEntranceStore.getState().setShowHighlights(false);
  usePedestrianEntranceStore.getState().setShowHighlights(false);
  useGreenSetbackStore.getState().setShowHighlights(false);
  usePlazaSetbackStore.getState().setShowHighlights(false);
  useSetbackRateCheckStore.getState().setShowSetbackLabels(false);
}

function showFeature(id: FeatureId) {
  hideAll();
  switch (id) {
    case "height-check":
      useHeightCheckStore.getState().setShowSetbackVolumes(true);
      useHeightCheckStore.getState().setShowHeightCheckLabels(true);
      break;
    case "setback-check":
      useSetbackCheckStore.getState().setShowHighlights(true);
      break;
    case "sight-corridor":
      useSightCorridorStore.getState().setShowCorridorLayer(true);
      useSightCorridorStore.getState().setShowBlockingLabels(true);
      break;
    case "fire-ladder":
      useFireLadderStore.getState().setShowLabels(true);
      break;
    case "sky-bridge":
      useSkyBridgeStore.getState().setShowLabels(true);
      break;
    case "vehicle-entrance-check":
      useVehicleEntranceStore.getState().setShowHighlights(true);
      break;
    case "pedestrian-entrance-check":
      usePedestrianEntranceStore.getState().setShowHighlights(true);
      break;
    case "green-setback-check":
      useGreenSetbackStore.getState().setShowHighlights(true);
      break;
    case "plaza-setback-check":
      usePlazaSetbackStore.getState().setShowHighlights(true);
      break;
    case "setback-rate-check":
      useSetbackRateCheckStore.getState().setShowSetbackLabels(true);
      break;
  }
}

// ---- result summary helpers ----

function useFeatureStatus(id: FeatureId): { checked: boolean; summary: string } {
  const heightResults = useHeightCheckStore((s) => s.results);
  const setbackResult = useSetbackCheckStore((s) => s.result);
  const corridorResult = useSightCorridorStore((s) => s.collisionResult);
  const fireLadderResults = useFireLadderStore((s) => s.results);
  const skyBridgeResults = useSkyBridgeStore((s) => s.results);
  const vehicleResult = useVehicleEntranceStore((s) => s.result);
  const pedestrianResult = usePedestrianEntranceStore((s) => s.result);
  const greenResult = useGreenSetbackStore((s) => s.result);
  const plazaResult = usePlazaSetbackStore((s) => s.result);
  const setbackRateResult = useSetbackRateCheckStore((s) => s.result);

  switch (id) {
    case "height-check": {
      if (!heightResults.length) return { checked: false, summary: "未检测" };
      const exceeded = heightResults.filter((r) => r.is_exceeded).length;
      return {
        checked: true,
        summary: exceeded > 0 ? `${exceeded} 项超高` : `全部通过 (${heightResults.length})`,
      };
    }
    case "setback-check": {
      if (!setbackResult) return { checked: false, summary: "未检测" };
      const { exceeded_count, total_buildings } = setbackResult.summary;
      return {
        checked: true,
        summary: exceeded_count > 0 ? `${exceeded_count} 项违规` : `全部通过 (${total_buildings})`,
      };
    }
    case "sight-corridor": {
      if (!corridorResult) return { checked: false, summary: "未检测" };
      const blocking = corridorResult.blocked_buildings?.length ?? 0;
      return {
        checked: true,
        summary: blocking > 0 ? `${blocking} 栋遮挡` : "通廊畅通",
      };
    }
    case "fire-ladder": {
      if (!fireLadderResults.length) return { checked: false, summary: "未检测" };
      const failed = fireLadderResults.filter((r) => r.status === "fail").length;
      return {
        checked: true,
        summary: failed > 0 ? `${failed} 项不合格` : `全部通过 (${fireLadderResults.length})`,
      };
    }
    case "sky-bridge": {
      if (!skyBridgeResults.length) return { checked: false, summary: "未检测" };
      const failed = skyBridgeResults.filter((r) => r.status === "fail").length;
      return {
        checked: true,
        summary: failed > 0 ? `${failed} 项不合格` : `全部通过 (${skyBridgeResults.length})`,
      };
    }
    case "vehicle-entrance-check": {
      if (!vehicleResult) return { checked: false, summary: "未检测" };
      const violations = vehicleResult.results?.filter((r) => r.status === "fail").length ?? 0;
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : `全部通过`,
      };
    }
    case "pedestrian-entrance-check": {
      if (!pedestrianResult) return { checked: false, summary: "未检测" };
      const violations = pedestrianResult.results?.filter((r) => r.status === "fail").length ?? 0;
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : `全部通过`,
      };
    }
    case "green-setback-check": {
      if (!greenResult) return { checked: false, summary: "未检测" };
      const violations = greenResult.summary?.violations ?? 0;
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : `全部通过`,
      };
    }
    case "plaza-setback-check": {
      if (!plazaResult) return { checked: false, summary: "未检测" };
      const violations = plazaResult.summary?.violations ?? 0;
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : `全部通过`,
      };
    }
    case "setback-rate-check": {
      if (!setbackRateResult) return { checked: false, summary: "未检测" };
      const failed = setbackRateResult.plots?.filter((p) => p.is_compliant === false).length ?? 0;
      return {
        checked: true,
        summary: failed > 0 ? `${failed} 个地块不达标` : `全部通过`,
      };
    }
  }
}

// ---- per-feature run functions ----

async function runCheck(id: FeatureId, modelPath: string): Promise<void> {
  switch (id) {
    case "height-check": {
      const data = await checkHeight({ model_path: modelPath });
      useHeightCheckStore.getState().setResults(data.buildings ?? []);
      useHeightCheckStore.getState().setWarnings(data.warnings ?? []);
      useHeightCheckStore.getState().setVolumes(data.setback_volumes ?? []);
      break;
    }
    case "setback-check": {
      const data = await checkSetback({ model_path: modelPath });
      useSetbackCheckStore.getState().setResult(data);
      break;
    }
    case "sight-corridor": {
      const data = await checkCorridorCollision({
        model_path: modelPath,
        corridor_layer: "限制_视线通廊",
        building_layer: "模型_建筑体块",
      });
      useSightCorridorStore.getState().setCollisionResult(data);
      break;
    }
    case "fire-ladder": {
      const data = await checkFireLadder({ model_path: modelPath });
      useFireLadderStore.getState().setResults(data.results ?? []);
      useFireLadderStore.getState().setWarnings(data.warnings ?? []);
      break;
    }
    case "sky-bridge": {
      const prep = await prepareSkyBridge({ model_path: modelPath });
      useSkyBridgeStore.getState().setPlots(prep.plots ?? []);
      useSkyBridgeStore.getState().setAutoConnections(prep.connections ?? []);
      useSkyBridgeStore.getState().setConnections(prep.connections ?? []);
      const connections = (prep.connections ?? []).map(
        (c: { from: string; to: string }) => [c.from, c.to] as [string, string]
      );
      const data = await checkSkyBridge({ model_path: modelPath, connections });
      useSkyBridgeStore.getState().setResults(data.results ?? []);
      useSkyBridgeStore.getState().setWarnings(data.warnings ?? []);
      break;
    }
    case "vehicle-entrance-check": {
      const data = await checkVehicleEntrance({ model_path: modelPath });
      useVehicleEntranceStore.getState().setResult(data);
      break;
    }
    case "pedestrian-entrance-check": {
      const data = await checkPedestrianEntrance({ model_path: modelPath });
      usePedestrianEntranceStore.getState().setResult(data);
      break;
    }
    case "green-setback-check": {
      const data = await checkGreenSetback({ model_path: modelPath });
      useGreenSetbackStore.getState().setResult(data);
      break;
    }
    case "plaza-setback-check": {
      const data = await checkPlazaSetback({ model_path: modelPath });
      usePlazaSetbackStore.getState().setResult(data);
      break;
    }
    case "setback-rate-check": {
      const apiBase = normalizeApiBase(API_BASE);
      const response = await fetch(`${apiBase}/setback-rate-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          model_path: modelPath,
          building_layer: "模型_建筑体块",
          setback_layer: "限制_建筑退线",
          plot_layer: "场景_地块",
          sample_step: 1.0,
          tolerance: 0.5,
          required_rate: 0.70,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "贴线率检测失败");
      }
      const data = await response.json();
      useSetbackRateCheckStore.getState().setResult(data);
      break;
    }
  }
  // 检测完成后确保不自动显示高亮（需用户主动点击眼睛）
  hideAll();
}

// ---- export helper ----

function openExportDialog(setExportDialogOpen: (open: boolean) => void) {
  setExportDialogOpen(true);
}

function getFeatureRawState(id: FeatureId) {
  switch (id) {
    case "height-check":
      return { results: useHeightCheckStore.getState().results };
    case "setback-check":
      return { result: useSetbackCheckStore.getState().result };
    case "sight-corridor":
      return { result: useSightCorridorStore.getState().collisionResult };
    case "fire-ladder":
      return { results: useFireLadderStore.getState().results };
    case "sky-bridge":
      return { results: useSkyBridgeStore.getState().results };
    case "vehicle-entrance-check":
      return { result: useVehicleEntranceStore.getState().result };
    case "pedestrian-entrance-check":
      return { result: usePedestrianEntranceStore.getState().result };
    case "green-setback-check":
      return { result: useGreenSetbackStore.getState().result };
    case "plaza-setback-check":
      return { result: usePlazaSetbackStore.getState().result };
    case "setback-rate-check":
      return { result: useSetbackRateCheckStore.getState().result };
  }
}

// ---- ChecklistItem component ----

function ChecklistItem({
  feature,
  isExpanded,
  onToggleExpand,
  isChecking,
  onRunCheck,
}: {
  feature: FeatureMeta;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isChecking: boolean;
  onRunCheck: () => void;
}) {
  const isVisible = useFeatureVisible(feature.id);
  const { checked, summary } = useFeatureStatus(feature.id);

  const handleEyeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVisible) {
      hideAll();
    } else {
      showFeature(feature.id);
    }
  };

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Row header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/50 select-none"
        onClick={onToggleExpand}
      >
        {/* Expand toggle */}
        <span className="text-muted-foreground shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>

        {/* Feature name */}
        <span className="flex-1 text-sm font-medium truncate">{feature.name}</span>

        {/* Status summary */}
        <span
          className={`text-xs shrink-0 ${
            !checked
              ? "text-muted-foreground"
              : summary.includes("通过") && !summary.includes("不") && !summary.includes("违规") && !summary.includes("超高") && !summary.includes("遮挡") && !summary.includes("不合格") && !summary.includes("不达标")
              ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {summary}
        </span>

        {/* Eye icon */}
        <button
          className={`shrink-0 p-0.5 rounded transition-colors ${
            isVisible
              ? "text-green-500 hover:text-green-600"
              : "text-muted-foreground/40 hover:text-muted-foreground"
          }`}
          onClick={handleEyeClick}
          title={isVisible ? "隐藏场景高亮" : "显示场景高亮"}
        >
          {isVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border/50 bg-muted/20">
          {/* Quick run button */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={isChecking}
              onClick={(e) => {
                e.stopPropagation();
                onRunCheck();
              }}
            >
              {isChecking ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <PlayCircle className="h-3 w-3 mr-1" />
              )}
              {isChecking ? "检测中..." : "开始检测"}
            </Button>
          </div>
          {/* Panel content */}
          <div className="p-2">
            <feature.Panel />
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Main component ----

export function ApprovalChecklistPanel() {
  const modelFilePath = useModelStore((s) => s.modelFilePath);
  const modelFile = useModelStore((s) => s.externalModelFile);
  const setModelFilePath = useModelStore((s) => s.setModelFilePath);

  const [expandedIds, setExpandedIds] = useState<Set<FeatureId>>(new Set());
  const [checkingId, setCheckingId] = useState<FeatureId | null>(null);
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FeatureId, string>>>({});
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // 离开审批清单时清除所有检测结果和高亮
  useEffect(() => {
    return () => {
      hideAll();
      toolRegistry.resetAll();
    };
  }, []);

  const toggleExpand = (id: FeatureId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resolveModelPath = async (): Promise<string | null> => {
    if (modelFilePath) return modelFilePath;
    if (!modelFile) return null;
    const apiBase = await resolveApiBase();
    const formData = new FormData();
    formData.append("file", modelFile);
    const res = await fetch(`${apiBase}/models/import?skip_layers=true`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("模型上传失败");
    const data = await res.json();
    if (data.model_path) setModelFilePath(data.model_path);
    return data.model_path ?? null;
  };

  const handleRunOne = async (id: FeatureId) => {
    if (checkingId || isCheckingAll) return;
    setCheckingId(id);
    setErrors((prev) => ({ ...prev, [id]: undefined }));
    try {
      const path = await resolveModelPath();
      if (!path) {
        setErrors((prev) => ({ ...prev, [id]: "请先上传模型文件" }));
        return;
      }
      await runCheck(id, path);
      setExpandedIds((prev) => new Set(prev).add(id));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "检测失败",
      }));
    } finally {
      setCheckingId(null);
    }
  };

  const handleRunAll = async () => {
    if (checkingId || isCheckingAll) return;
    setIsCheckingAll(true);
    setErrors({});
    try {
      const path = await resolveModelPath();
      if (!path) {
        setErrors({ "height-check": "请先上传模型文件" });
        return;
      }
      for (const feature of FEATURES) {
        setCheckingId(feature.id);
        try {
          await runCheck(feature.id, path);
        } catch (err) {
          setErrors((prev) => ({
            ...prev,
            [feature.id]: err instanceof Error ? err.message : "检测失败",
          }));
        }
      }
      setCheckingId(null);
    } finally {
      setIsCheckingAll(false);
      setCheckingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-sm font-semibold">管控审批清单</span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={isCheckingAll || !!checkingId}
            onClick={handleRunAll}
          >
            {isCheckingAll ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <PlayCircle className="h-3 w-3 mr-1" />
            )}
            {isCheckingAll ? "检测中..." : "一键检测"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => openExportDialog(setExportDialogOpen)}
          >
            <Download className="h-3 w-3 mr-1" />
            导出
          </Button>
        </div>
      </div>

      {/* Checklist */}
      <div className="flex-1 overflow-y-auto">
        {FEATURES.map((feature) => (
          <div key={feature.id}>
            <ChecklistItem
              feature={feature}
              isExpanded={expandedIds.has(feature.id)}
              onToggleExpand={() => toggleExpand(feature.id)}
              isChecking={checkingId === feature.id}
              onRunCheck={() => handleRunOne(feature.id)}
            />
            {errors[feature.id] && (
              <div className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-b border-border">
                {errors[feature.id]}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Export Dialog */}
      <ExportChecklistDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        features={FEATURES.map((f) => {
          const state = getFeatureRawState(f.id);
          const { summary } = useFeatureStatus(f.id);
          return {
            id: f.id,
            name: f.name,
            summary,
            rawResult: state,
          };
        })}
      />
    </div>
  );
}
