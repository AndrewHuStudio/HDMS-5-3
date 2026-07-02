"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import "@/features";
import { Button } from "@/components/ui/button";
import { CityScene, type ImportedMeshInfo, type ViewMode } from "@/components/city-scene";
import { ViewControls } from "@/components/view-controls";
import { ModelUploader } from "@/components/model-uploader";
import { AppShell } from "@/components/app-shell";
import { DataUploadPanel } from "@/components/data-upload-panel";
import { ToolPanelWrapper } from "@/components/tools/tool-panel-wrapper";
import { ThemeToggle } from "@/components/theme-toggle";
import { ApprovalChecklistPanel } from "@/components/approval-checklist-panel";
import { QAView } from "@/features/qa";
import { QAConversationToolbar } from "@/components/qa-new/qa-conversation-toolbar";
import type { CityElement } from "@/lib/city-data";
import { toolRegistry, useToolSceneProps } from "@/lib/registries/tool-registry";
import { deriveToolRunStatus, resolveAutoRevealToolId } from "@/lib/tool-view-state";
import { resolveReviewSidebarToolStatusMap } from "@/lib/review-tool-links";
import {
  hideAllReviewToolVisuals,
  REVIEW_TOOL_IDS,
  showOnlyReviewToolVisuals,
} from "@/lib/review-visual-controls";
import { useModelLoader } from "@/lib/hooks/use-model-loader";
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
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";

export function PersistentWorkspaceShell() {
  const ASSISTANT_BASE_PANEL_WIDTH = 420;
  const ASSISTANT_MIN_PANEL_WIDTH = 360;
  const ASSISTANT_MAX_PANEL_WIDTH = 720;
  const ASSISTANT_HISTORY_PANEL_WIDTH = 280;
  const pathname = usePathname();
  const isUploadsRoute = pathname === "/uploads";
  const isReviewsRoute = pathname === "/reviews";
  const isAssistantRoute = pathname === "/assistant";
  const isApprovalsRoute = pathname === "/approvals";

  const [selectedElement, setSelectedElement] = useState<CityElement | null>(null);
  const [selectedImportedMesh, setSelectedImportedMesh] = useState<ImportedMeshInfo | null>(null);
  const [activeToolId, setActiveToolId] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("perspective");
  const [reviewPanelWidth, setReviewPanelWidth] = useState(360);
  const [assistantPanelWidth, setAssistantPanelWidth] = useState(ASSISTANT_BASE_PANEL_WIDTH);
  const [assistantHistoryOpen, setAssistantHistoryOpen] = useState(false);
  const [isReviewResizing, setIsReviewResizing] = useState(false);
  const [isAssistantResizing, setIsAssistantResizing] = useState(false);

  const {
    externalModelUrl,
    externalModelType,
    externalModelName,
    modelError,
    setModelError,
    setModelBounds,
    setModelScale,
    setModelTransform,
    setModelBuildings,
    handleModelLoad,
    handleClearModel,
  } = useModelLoader();

  useEffect(() => {
    if (!isReviewsRoute) {
      return;
    }
    const toolParam = new URLSearchParams(window.location.search).get("tool");
    if (toolParam && toolRegistry.has(toolParam)) {
      setActiveToolId(toolParam);
    }
  }, [isReviewsRoute, pathname]);

  const heightCheckResults = useHeightCheckStore((state) => state.results);
  const setbackResult = useSetbackCheckStore((state) => state.result);
  const corridorResult = useSightCorridorStore((state) => state.collisionResult);
  const fireLadderResults = useFireLadderStore((state) => state.results);
  const skyBridgeResults = useSkyBridgeStore((state) => state.results);
  const vehicleResult = useVehicleEntranceStore((state) => state.result);
  const pedestrianResult = usePedestrianEntranceStore((state) => state.result);
  const greenResult = useGreenSetbackStore((state) => state.result);
  const plazaResult = usePlazaSetbackStore((state) => state.result);
  const setbackRateResult = useSetbackRateCheckStore((state) => state.result);

  const toolStatusMap = useMemo<Record<string, "idle" | "pass" | "fail">>(() => ({
    "height-check": deriveToolRunStatus(
      heightCheckResults.length > 0,
      heightCheckResults.some((result) => result.is_exceeded)
    ),
    "setback-check": deriveToolRunStatus(
      Boolean(setbackResult),
      (setbackResult?.summary.exceeded_count ?? 0) > 0
    ),
    "view-corridor-check": deriveToolRunStatus(
      Boolean(corridorResult),
      corridorResult ? corridorResult.status !== "clear" : false
    ),
    "fire-ladder-check": deriveToolRunStatus(
      fireLadderResults.length > 0,
      fireLadderResults.some((result) => result.status === "fail")
    ),
    "sky-bridge-check": deriveToolRunStatus(
      skyBridgeResults.length > 0,
      skyBridgeResults.some((result) => result.status === "fail")
    ),
    "vehicle-entrance-check": deriveToolRunStatus(
      Boolean(vehicleResult),
      (vehicleResult?.summary.failed ?? 0) > 0
    ),
    "pedestrian-entrance-check": deriveToolRunStatus(
      Boolean(pedestrianResult),
      (pedestrianResult?.summary.failed ?? 0) > 0
    ),
    "green-setback-check": deriveToolRunStatus(
      Boolean(greenResult),
      (greenResult?.summary.violations ?? 0) > 0
    ),
    "plaza-setback-check": deriveToolRunStatus(
      Boolean(plazaResult),
      (plazaResult?.summary.violations ?? 0) > 0
    ),
    "setback-rate-check": deriveToolRunStatus(
      Boolean(setbackRateResult),
      setbackRateResult ? setbackRateResult.plots.some((plot) => plot.is_compliant === false) : false
    ),
  }), [
    heightCheckResults,
    setbackResult,
    corridorResult,
    fireLadderResults,
    skyBridgeResults,
    vehicleResult,
    pedestrianResult,
    greenResult,
    plazaResult,
    setbackRateResult,
  ]);

  const reviewToolIds = useMemo<string[]>(() => [...REVIEW_TOOL_IDS], []);
  const reviewSceneProps = useToolSceneProps(activeToolId);
  const approvalSceneProps = useToolSceneProps("approval-checklist");
  const activeTool = toolRegistry.get(activeToolId);

  useEffect(() => {
    if (!isReviewsRoute) {
      return;
    }
    const autoRevealToolId = resolveAutoRevealToolId(activeToolId, reviewToolIds, toolStatusMap);
    hideAllReviewToolVisuals();
    if (autoRevealToolId) {
      showOnlyReviewToolVisuals(autoRevealToolId);
    }
  }, [activeToolId, isReviewsRoute, reviewToolIds, toolStatusMap]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (isReviewResizing) {
        const newWidth = window.innerWidth - event.clientX;
        setReviewPanelWidth(Math.max(360, Math.min(500, newWidth)));
      }
      if (isAssistantResizing) {
        const newWidth = window.innerWidth - event.clientX;
        setAssistantPanelWidth(Math.max(ASSISTANT_MIN_PANEL_WIDTH, Math.min(ASSISTANT_MAX_PANEL_WIDTH, newWidth)));
      }
    };
    const handleMouseUp = () => {
      setIsReviewResizing(false);
      setIsAssistantResizing(false);
    };
    if (isReviewResizing || isAssistantResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isAssistantResizing, isReviewResizing]);

  useEffect(() => {
    if (!isAssistantRoute && assistantHistoryOpen) {
      setAssistantHistoryOpen(false);
    }
  }, [assistantHistoryOpen, isAssistantRoute]);

  const activeSceneViewId = isReviewsRoute
    ? activeToolId
    : isApprovalsRoute
      ? "approval-checklist"
      : "";

  const activeSceneProps = isReviewsRoute
    ? reviewSceneProps
    : isApprovalsRoute
      ? approvalSceneProps
      : {};

  const sceneTitle = isApprovalsRoute
    ? "管控审批清单"
    : "";
  const assistantPanelTotalWidth = assistantHistoryOpen
    ? assistantPanelWidth + ASSISTANT_HISTORY_PANEL_WIDTH
    : assistantPanelWidth;
  const handleAssistantViewportPointerDown = () => {
    if (isAssistantRoute && assistantHistoryOpen) {
      setAssistantHistoryOpen(false);
    }
  };

  if (isUploadsRoute) {
    return (
      <AppShell
        toolStatusMap={{}}
        activeToolId={undefined}
        onToolNavigate={undefined}
      >
        <section className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 flex-shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="font-medium">管控资料上传</h2>
              <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                严格串行
              </span>
            </div>
            <ThemeToggle />
          </header>
          <DataUploadPanel />
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell
      toolStatusMap={resolveReviewSidebarToolStatusMap(pathname, toolStatusMap)}
      activeToolId={isReviewsRoute ? activeToolId : undefined}
      onToolNavigate={isReviewsRoute ? setActiveToolId : undefined}
    >
      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 flex-shrink-0">
          <h2 className="font-medium">{sceneTitle}</h2>
          <div className="flex items-center gap-4">
            <ViewControls currentView={viewMode} onViewChange={setViewMode} />
            <div className="w-px h-6 bg-border" />
            <ModelUploader
              onModelLoad={handleModelLoad}
              currentModel={externalModelUrl}
              currentModelName={externalModelName}
              onClearModel={handleClearModel}
            />
            <ThemeToggle />
          </div>
        </header>

        <div
          className="flex-1 min-h-0 relative isometric-grid overflow-hidden"
          onPointerDownCapture={handleAssistantViewportPointerDown}
        >
          <CityScene
            onSelectElement={(element) => {
              setSelectedElement(element);
              if (element) {
                setSelectedImportedMesh(null);
              }
            }}
            selectedElement={selectedElement}
            externalModelUrl={externalModelUrl}
            externalModelType={externalModelType}
            onModelError={setModelError}
            onImportedMeshSelect={(mesh) => {
              setSelectedImportedMesh(mesh);
              if (mesh) {
                setSelectedElement(null);
              }
            }}
            selectedImportedMesh={selectedImportedMesh}
            viewMode={viewMode}
            activeViewId={activeSceneViewId}
            {...activeSceneProps}
            onModelBoundsComputed={(bounds) => {
              if (bounds) {
                setModelBounds({
                  min: [bounds.min.x, bounds.min.y, bounds.min.z],
                  max: [bounds.max.x, bounds.max.y, bounds.max.z],
                });
              } else {
                setModelBounds(undefined);
              }
            }}
            onModelScaleComputed={(scale) => {
              if (Number.isFinite(scale) && scale > 0) {
                setModelScale(scale);
              } else {
                setModelScale(1);
              }
            }}
            onModelTransformComputed={setModelTransform}
            onBuildingsExtracted={setModelBuildings}
          />

          {isReviewsRoute && selectedElement && selectedElement.controls.some((control) => control.status === "exceeded") && (
            <div className="absolute bg-card border border-red-200 rounded-lg shadow-lg p-4 max-w-[300px]" style={{ right: `${reviewPanelWidth + 20}px`, top: "20px" }}>
              <div className="flex items-center gap-2 mb-3">
                <XCircle className="h-5 w-5 text-red-500" />
                <span className="font-medium text-red-600">管控报错</span>
              </div>
              <div className="space-y-3">
                {selectedElement.controls.filter((control) => control.status === "exceeded").map((control) => (
                  <div key={control.id} className="pb-2 border-b border-border last:border-0 last:pb-0">
                    <p className="text-sm font-medium text-red-600">{control.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">来源: {selectedElement.name}</p>
                    <p className="text-xs text-muted-foreground">
                      当前值: {control.currentValue}{control.unit}，限制值: {control.limitValue}{control.unit}
                    </p>
                    {control.suggestion && <p className="text-xs text-amber-600 mt-1">{control.suggestion}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {modelError && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg shadow-lg">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{modelError}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs hover:bg-red-100"
                onClick={() => setModelError(null)}
              >
                关闭
              </Button>
            </div>
          )}

          {isReviewsRoute && selectedElement && (
            <div className="absolute bottom-4 left-4 bg-card border border-border rounded-lg shadow-lg p-4 max-w-[320px]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">{selectedElement.name}</h3>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setSelectedElement(null)}>关闭</Button>
              </div>
              <div className="space-y-2">
                {selectedElement.controls.slice(0, 3).map((control) => (
                  <div key={control.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{control.name}</span>
                    <div className="flex items-center gap-2">
                      <span>{control.currentValue}{control.unit}</span>
                      {control.status === "safe" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                      {control.status === "exceeded" && <XCircle className="h-4 w-4 text-red-500" />}
                      {control.status === "in-progress" && <Clock className="h-4 w-4 text-amber-500" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isReviewsRoute && selectedImportedMesh && (
            <div className="absolute bottom-4 left-4 bg-card border border-border rounded-lg shadow-lg p-4 max-w-[320px]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">{selectedImportedMesh.name}</h3>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setSelectedImportedMesh(null)}>关闭</Button>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">类型</span>
                  <span>导入对象</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">ID</span>
                  <span className="text-xs font-mono">{selectedImportedMesh.id}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {isReviewsRoute ? (
        <aside
          className="border-l border-border bg-card flex flex-col flex-shrink-0 min-h-0 overflow-hidden relative"
          style={{ width: `${reviewPanelWidth}px` }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 transition-colors z-10"
            onMouseDown={() => setIsReviewResizing(true)}
            title="拖动调整宽度"
          />
          <div className="h-12 border-b border-border flex items-center px-4 flex-shrink-0">
            <h2 className="font-medium">{activeTool?.name ?? "管控审查系统"}</h2>
          </div>
          <div className="relative flex-1 min-h-0 overflow-y-auto p-4 review-result-scrollbar">
            {activeTool ? (
              <ToolPanelWrapper tool={activeTool}>
                {activeTool.Panel ? <activeTool.Panel /> : null}
              </ToolPanelWrapper>
            ) : (
              <p className="text-sm text-muted-foreground">从左侧选择管控工具开始检测</p>
            )}
          </div>
        </aside>
      ) : isAssistantRoute ? (
        <aside
          className="border-l border-border bg-card flex flex-col flex-shrink-0 min-h-0 overflow-hidden relative transition-[width] duration-300 ease-out"
          style={{ width: `${assistantPanelTotalWidth}px` }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-primary/50 transition-colors"
            onMouseDown={() => setIsAssistantResizing(true)}
            title="拖动调整问答栏宽度"
          />
          <div className="h-12 border-b border-border flex items-center px-4 flex-shrink-0">
            <QAConversationToolbar
              historyOpen={assistantHistoryOpen}
              onToggleHistory={() => setAssistantHistoryOpen((open) => !open)}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <QAView
              embedded
              historyOpen={assistantHistoryOpen}
              onHistoryOpenChange={setAssistantHistoryOpen}
            />
          </div>
        </aside>
      ) : (
        <aside className="w-[420px] border-l border-border bg-card flex flex-col flex-shrink-0 min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            <ApprovalChecklistPanel />
          </div>
        </aside>
      )}
    </AppShell>
  );
}
