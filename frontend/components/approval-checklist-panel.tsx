"use client";

import { useState, useEffect } from "react";
import { create } from "zustand";
import { ChevronRight, ChevronDown, Eye, EyeOff, Loader2, Download, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModelStore } from "@/lib/stores/model-store";
import { resolveApiBase, API_BASE, normalizeApiBase } from "@/lib/api-base";
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
import {
  hideAllReviewToolVisuals,
  showOnlyReviewToolVisuals,
} from "@/lib/review-visual-controls";
import { getPedestrianEntranceViolationCount } from "@/lib/approval-checklist-status";

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
  { id: "setback-rate-check", name: "贴线率检测", Panel: SetbackRatePanel },
  { id: "sight-corridor", name: "视线通廊检测", Panel: SightCorridorPanelAdapter },
  { id: "sky-bridge", name: "空中连廊检测", Panel: SkyBridgePanel },
  { id: "fire-ladder", name: "消防登高面检测", Panel: FireLadderPanel },
  { id: "vehicle-entrance-check", name: "车行出入口检测", Panel: VehicleEntrancePanel },
  { id: "pedestrian-entrance-check", name: "人行出入口检测", Panel: PedestrianEntrancePanel },
  { id: "setback-check", name: "退线检测", Panel: SetbackPanel },
  { id: "green-setback-check", name: "绿地退线控制检测", Panel: GreenSetbackPanel },
  { id: "plaza-setback-check", name: "广场退线控制检测", Panel: PlazaSetbackPanel },
];

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

// ---- result summary helpers ----

function useFeatureStatus(id: FeatureId): { checked: boolean; summary: string; isPass: boolean } {
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
      if (!heightResults.length) return { checked: false, summary: "未检测", isPass: false };
      const exceeded = heightResults.filter((r) => r.is_exceeded).length;
      return {
        checked: true,
        summary: exceeded > 0 ? `${exceeded} 项超高` : `全部通过 (${heightResults.length})`,
        isPass: exceeded === 0,
      };
    }
    case "setback-check": {
      if (!setbackResult) return { checked: false, summary: "未检测", isPass: false };
      const { exceeded_count, total_buildings } = setbackResult.summary;
      return {
        checked: true,
        summary: exceeded_count > 0 ? `${exceeded_count} 项违规` : `全部通过 (${total_buildings})`,
        isPass: exceeded_count === 0,
      };
    }
    case "sight-corridor": {
      if (!corridorResult) return { checked: false, summary: "未检测", isPass: false };
      const blocking = corridorResult.blocked_buildings?.length ?? 0;
      return {
        checked: true,
        summary: blocking > 0 ? `${blocking} 栋遮挡` : "通廊畅通",
        isPass: blocking === 0,
      };
    }
    case "fire-ladder": {
      if (!fireLadderResults.length) return { checked: false, summary: "未检测", isPass: false };
      const failed = fireLadderResults.filter((r) => r.status === "fail").length;
      return {
        checked: true,
        summary: failed > 0 ? `${failed} 项不合格` : `全部通过 (${fireLadderResults.length})`,
        isPass: failed === 0,
      };
    }
    case "sky-bridge": {
      if (!skyBridgeResults.length) return { checked: false, summary: "未检测", isPass: false };
      const failed = skyBridgeResults.filter((r) => r.status === "fail").length;
      return {
        checked: true,
        summary: failed > 0 ? `${failed} 项不合格` : `全部通过 (${skyBridgeResults.length})`,
        isPass: failed === 0,
      };
    }
    case "vehicle-entrance-check": {
      if (!vehicleResult) return { checked: false, summary: "未检测", isPass: false };
      const violations = vehicleResult.results?.filter((r) => r.status === "fail").length ?? 0;
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : `全部通过`,
        isPass: violations === 0,
      };
    }
    case "pedestrian-entrance-check": {
      if (!pedestrianResult) return { checked: false, summary: "未检测", isPass: false };
      const violations = getPedestrianEntranceViolationCount(pedestrianResult);
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : `全部通过`,
        isPass: violations === 0,
      };
    }
    case "green-setback-check": {
      if (!greenResult) return { checked: false, summary: "未检测", isPass: false };
      const violations = greenResult.summary?.violations ?? 0;
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : `全部通过`,
        isPass: violations === 0,
      };
    }
    case "plaza-setback-check": {
      if (!plazaResult) return { checked: false, summary: "未检测", isPass: false };
      const violations = plazaResult.summary?.violations ?? 0;
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : `全部通过`,
        isPass: violations === 0,
      };
    }
    case "setback-rate-check": {
      if (!setbackRateResult) return { checked: false, summary: "未检测", isPass: false };
      const failed = setbackRateResult.plots?.filter((p) => p.is_compliant === false).length ?? 0;
      return {
        checked: true,
        summary: failed > 0 ? `${failed} 个地块不达标` : `全部通过`,
        isPass: failed === 0,
      };
    }
  }
}

function getFeatureStatusSnapshot(id: FeatureId): { checked: boolean; summary: string; isPass: boolean } {
  switch (id) {
    case "height-check": {
      const heightResults = useHeightCheckStore.getState().results;
      if (!heightResults.length) return { checked: false, summary: "未检测", isPass: false };
      const exceeded = heightResults.filter((r) => r.is_exceeded).length;
      return {
        checked: true,
        summary: exceeded > 0 ? `${exceeded} 项超高` : `全部通过 (${heightResults.length})`,
        isPass: exceeded === 0,
      };
    }
    case "setback-check": {
      const setbackResult = useSetbackCheckStore.getState().result;
      if (!setbackResult) return { checked: false, summary: "未检测", isPass: false };
      const { exceeded_count, total_buildings } = setbackResult.summary;
      return {
        checked: true,
        summary: exceeded_count > 0 ? `${exceeded_count} 项违规` : `全部通过 (${total_buildings})`,
        isPass: exceeded_count === 0,
      };
    }
    case "sight-corridor": {
      const corridorResult = useSightCorridorStore.getState().collisionResult;
      if (!corridorResult) return { checked: false, summary: "未检测", isPass: false };
      const blocking = corridorResult.blocked_buildings?.length ?? 0;
      return {
        checked: true,
        summary: blocking > 0 ? `${blocking} 栋遮挡` : "通廊畅通",
        isPass: blocking === 0,
      };
    }
    case "fire-ladder": {
      const fireLadderResults = useFireLadderStore.getState().results;
      if (!fireLadderResults.length) return { checked: false, summary: "未检测", isPass: false };
      const failed = fireLadderResults.filter((r) => r.status === "fail").length;
      return {
        checked: true,
        summary: failed > 0 ? `${failed} 项不合格` : `全部通过 (${fireLadderResults.length})`,
        isPass: failed === 0,
      };
    }
    case "sky-bridge": {
      const skyBridgeResults = useSkyBridgeStore.getState().results;
      if (!skyBridgeResults.length) return { checked: false, summary: "未检测", isPass: false };
      const failed = skyBridgeResults.filter((r) => r.status === "fail").length;
      return {
        checked: true,
        summary: failed > 0 ? `${failed} 项不合格` : `全部通过 (${skyBridgeResults.length})`,
        isPass: failed === 0,
      };
    }
    case "vehicle-entrance-check": {
      const vehicleResult = useVehicleEntranceStore.getState().result;
      if (!vehicleResult) return { checked: false, summary: "未检测", isPass: false };
      const violations = vehicleResult.results?.filter((r) => r.status === "fail").length ?? 0;
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : "全部通过",
        isPass: violations === 0,
      };
    }
    case "pedestrian-entrance-check": {
      const pedestrianResult = usePedestrianEntranceStore.getState().result;
      if (!pedestrianResult) return { checked: false, summary: "未检测", isPass: false };
      const violations = getPedestrianEntranceViolationCount(pedestrianResult);
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : "全部通过",
        isPass: violations === 0,
      };
    }
    case "green-setback-check": {
      const greenResult = useGreenSetbackStore.getState().result;
      if (!greenResult) return { checked: false, summary: "未检测", isPass: false };
      const violations = greenResult.summary?.violations ?? 0;
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : "全部通过",
        isPass: violations === 0,
      };
    }
    case "plaza-setback-check": {
      const plazaResult = usePlazaSetbackStore.getState().result;
      if (!plazaResult) return { checked: false, summary: "未检测", isPass: false };
      const violations = plazaResult.summary?.violations ?? 0;
      return {
        checked: true,
        summary: violations > 0 ? `${violations} 项违规` : "全部通过",
        isPass: violations === 0,
      };
    }
    case "setback-rate-check": {
      const setbackRateResult = useSetbackRateCheckStore.getState().result;
      if (!setbackRateResult) return { checked: false, summary: "未检测", isPass: false };
      const failed = setbackRateResult.plots?.filter((p) => p.is_compliant === false).length ?? 0;
      return {
        checked: true,
        summary: failed > 0 ? `${failed} 个地块不达标` : "全部通过",
        isPass: failed === 0,
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
      const data = await checkVehicleEntrance({
        model_path: modelPath,
        plot_layer: "场景_地块",
      });
      useVehicleEntranceStore.getState().setResult(data);
      break;
    }
    case "pedestrian-entrance-check": {
      const data = await checkPedestrianEntrance({
        model_path: modelPath,
        plot_layer: "场景_地块",
      });
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
  hideAllReviewToolVisuals();
}

// ---- export helper ----

function openExportDialog(setExportDialogOpen: (open: boolean) => void) {
  setExportDialogOpen(true);
}

function getFeatureRawState(id: FeatureId) {
  switch (id) {
    case "height-check":
      return useHeightCheckStore.getState().results;
    case "setback-check":
      return useSetbackCheckStore.getState().result;
    case "sight-corridor":
      return useSightCorridorStore.getState().collisionResult;
    case "fire-ladder":
      return { results: useFireLadderStore.getState().results };
    case "sky-bridge":
      return { results: useSkyBridgeStore.getState().results };
    case "vehicle-entrance-check":
      return useVehicleEntranceStore.getState().result;
    case "pedestrian-entrance-check":
      return usePedestrianEntranceStore.getState().result;
    case "green-setback-check":
      return useGreenSetbackStore.getState().result;
    case "plaza-setback-check":
      return usePlazaSetbackStore.getState().result;
    case "setback-rate-check":
      return useSetbackRateCheckStore.getState().result;
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
  const { checked, summary, isPass } = useFeatureStatus(feature.id);

  const handleEyeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isVisible) {
      hideAllReviewToolVisuals();
    } else {
      showOnlyReviewToolVisuals(feature.id);
    }
  };

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Row header */}
      <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-muted/50 select-none">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer text-left"
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
                : isPass
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
            }`}
          >
            {summary}
          </span>
        </button>

        {/* Eye icon */}
        <button
          type="button"
          aria-label={isVisible ? `隐藏${feature.name}场景高亮` : `显示${feature.name}场景高亮`}
          className={`shrink-0 inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
            isVisible
              ? "text-green-500 hover:bg-muted/70 hover:text-green-600"
              : "text-muted-foreground/50 hover:bg-muted/70 hover:text-muted-foreground"
          }`}
          onClick={handleEyeClick}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          title={isVisible ? "隐藏场景高亮" : "显示场景高亮"}
          style={{ cursor: "pointer" }}
        >
          {isVisible ? (
            <Eye className="h-4 w-4 pointer-events-none" />
          ) : (
            <EyeOff className="h-4 w-4 pointer-events-none" />
          )}
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

// ---- Persistent store for approval checklist UI state ----

interface ApprovalChecklistUIState {
  expandedIds: Set<FeatureId>;
  toggleExpanded: (id: FeatureId) => void;
  addExpanded: (id: FeatureId) => void;
}

const useApprovalChecklistUIStore = create<ApprovalChecklistUIState>((set) => ({
  expandedIds: new Set(),
  toggleExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedIds: next };
    }),
  addExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedIds);
      next.add(id);
      return { expandedIds: next };
    }),
}));

// ---- Main component ----

export function ApprovalChecklistPanel() {
  const modelFilePath = useModelStore((s) => s.modelFilePath);
  const modelFile = useModelStore((s) => s.externalModelFile);
  const setModelFilePath = useModelStore((s) => s.setModelFilePath);

  const expandedIds = useApprovalChecklistUIStore((s) => s.expandedIds);
  const toggleExpanded = useApprovalChecklistUIStore((s) => s.toggleExpanded);
  const addExpanded = useApprovalChecklistUIStore((s) => s.addExpanded);

  const [checkingId, setCheckingId] = useState<FeatureId | null>(null);
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FeatureId, string>>>({});
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // 离开审批清单时仅隐藏高亮，保留检测结果以支持会话内切页返回
  useEffect(() => {
    return () => {
      hideAllReviewToolVisuals();
    };
  }, []);

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
      addExpanded(id);
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
      <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-b border-border shrink-0">
        <Button
          size="default"
          variant="outline"
          className="flex-1 cursor-pointer"
          disabled={isCheckingAll || !!checkingId}
          onClick={handleRunAll}
        >
          {isCheckingAll ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4 mr-2" />
          )}
          {isCheckingAll ? "检测中..." : "一键检测"}
        </Button>
        <Button
          size="default"
          className="flex-1 cursor-pointer"
          onClick={() => openExportDialog(setExportDialogOpen)}
        >
          <Download className="h-4 w-4 mr-2" />
          结果导出
        </Button>
      </div>

      {/* Checklist */}
      <div className="flex-1 overflow-y-auto">
        {FEATURES.map((feature) => (
          <div key={feature.id}>
            <ChecklistItem
              feature={feature}
              isExpanded={expandedIds.has(feature.id)}
              onToggleExpand={() => toggleExpanded(feature.id)}
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
          const { checked, summary, isPass } = getFeatureStatusSnapshot(f.id);
          return {
            id: f.id,
            name: f.name,
            checked,
            isPass,
            summary,
            rawResult: state,
          };
        })}
      />
    </div>
  );
}
