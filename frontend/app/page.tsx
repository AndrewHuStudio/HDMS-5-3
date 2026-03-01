"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import "@/features";
import { Button } from "@/components/ui/button";
import { CityScene, type ImportedMeshInfo, type ModelFileType, type ViewMode } from "@/components/city-scene";
import { ViewControls } from "@/components/view-controls";
import { ApprovalChecklistPanel } from "@/components/approval-checklist-panel";
import { QAPanel } from "@/components/qa-panel";
import { DataUploadPanel } from "@/components/data-upload-panel";
import { ModelUploader, type LayerInfo } from "@/components/model-uploader";
import { SidebarNav } from "@/components/navigation/sidebar-nav";
import { ToolPanelWrapper } from "@/components/tools/tool-panel-wrapper";
import { ThemeToggle } from "@/components/theme-toggle";
import type { CityElement } from "@/lib/city-data";
import { mainNavigation } from "@/lib/navigation-config";
import type { ActiveView } from "@/lib/navigation-types";
import { toolRegistry, useToolSceneProps } from "@/lib/registries/tool-registry";
import { deriveToolRunStatus, resolveAutoRevealToolId } from "@/lib/tool-view-state";
import {
  hideAllReviewToolVisuals,
  REVIEW_TOOL_IDS,
  showOnlyReviewToolVisuals,
} from "@/lib/review-visual-controls";
import { useModelStore } from "@/lib/stores/model-store";
import { useQAViewStore } from "@/lib/stores/qa-store";
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
import { cn } from "@/lib/utils";
import {
  Building2,
  Clock,
  XCircle,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  PanelRight,
  SquarePen,
  MoreHorizontal,
  Pin,
  Pencil,
  Trash2,
} from "lucide-react";

export default function CityControlSystem() {
  const QA_HISTORY_PANEL_WIDTH = 288;
  const [selectedElement, setSelectedElement] = useState<CityElement | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("data-upload");
  const [selectedImportedMesh, setSelectedImportedMesh] = useState<ImportedMeshInfo | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("perspective");
  const [rightPanelWidth, setRightPanelWidth] = useState(360);
  const [isResizing, setIsResizing] = useState(false);
  const [isQAHistoryOpen, setIsQAHistoryOpen] = useState(false);
  const [historyMenuConversationId, setHistoryMenuConversationId] = useState<string | null>(null);

  const externalModelUrl = useModelStore((state) => state.externalModelUrl);
  const externalModelType = useModelStore((state) => state.externalModelType);
  const externalModelName = useModelStore((state) => state.externalModelName);
  const modelError = useModelStore((state) => state.modelError);

  const setExternalModel = useModelStore((state) => state.setExternalModel);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);
  const setModelLayers = useModelStore((state) => state.setModelLayers);
  const setModelBounds = useModelStore((state) => state.setModelBounds);
  const setModelScale = useModelStore((state) => state.setModelScale);
  const setModelTransform = useModelStore((state) => state.setModelTransform);
  const setModelBuildings = useModelStore((state) => state.setModelBuildings);
  const setModelError = useModelStore((state) => state.setModelError);
  const resetModel = useModelStore((state) => state.resetModel);
  const qaConversations = useQAViewStore((state) => state.conversations);
  const qaActiveConversationId = useQAViewStore((state) => state.activeConversationId);
  const createQAConversation = useQAViewStore((state) => state.createConversation);
  const switchQAConversation = useQAViewStore((state) => state.switchConversation);
  const renameQAConversation = useQAViewStore((state) => state.renameConversation);
  const deleteQAConversation = useQAViewStore((state) => state.deleteConversation);
  const togglePinQAConversation = useQAViewStore((state) => state.togglePinConversation);

  const tools = toolRegistry.getAll();
  const toolSceneProps = useToolSceneProps(activeView);
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
  const currentModelRef = useRef<{ url: string | null; type: ModelFileType | null }>({
    url: null,
    type: null,
  });

  useEffect(() => {
    const autoRevealToolId = resolveAutoRevealToolId(activeView, reviewToolIds, toolStatusMap);
    hideAllReviewToolVisuals();
    if (autoRevealToolId) {
      showOnlyReviewToolVisuals(autoRevealToolId);
    }
  }, [activeView, reviewToolIds, toolStatusMap]);

  const handleModelLoad = (
    url: string,
    fileName: string,
    fileType: ModelFileType,
    modelPath?: string,
    layers?: LayerInfo[],
    file?: File
  ) => {
    const isSameModel = currentModelRef.current.url === url && currentModelRef.current.type === fileType;
    if (isSameModel) {
      if (modelPath) {
        setModelFilePath(modelPath);
      }
      if (layers) {
        setModelLayers(layers);
      }
      if (fileName || file) {
        setExternalModel({ url, type: fileType, name: fileName, file: file ?? null });
      }
      return;
    }

    setExternalModel({ url, type: fileType, name: fileName, file: file ?? null });
    currentModelRef.current = { url, type: fileType };
    setModelError(null);
    setModelFilePath(modelPath ?? null);
    setModelLayers(layers || []);
    setModelBounds(undefined);
    setModelScale(1);
    setModelTransform(null);
    setModelBuildings([]);
    toolRegistry.resetAll();
  };

  const handleClearModel = () => {
    if (externalModelUrl) {
      URL.revokeObjectURL(externalModelUrl);
    }
    currentModelRef.current = { url: null, type: null };
    resetModel();
    toolRegistry.resetAll();
  };

  // 动态生成导航配置，将管控工具填充到"管控审查系统"的子菜单中
  const navigationWithTools = useMemo(() => {
    return mainNavigation.map((item) => {
      if (item.id === "control-review") {
        return {
          ...item,
          description: `${tools.length} 个管控工具`,
          children: tools.map((tool) => ({
            id: tool.id,
            label: tool.name,
            icon: tool.icon,
            description: tool.description,
            toolRunStatus: toolStatusMap[tool.id] ?? "idle",
          })),
        };
      }
      return item;
    });
  }, [tools, toolStatusMap]);

  const activeTool = toolRegistry.get(activeView);
  const isQAPanel = activeView === "qa-assistant";
  const isQAHistoryDocked = isQAPanel && isQAHistoryOpen;
  const effectiveRightPanelWidth = rightPanelWidth + (isQAHistoryDocked ? QA_HISTORY_PANEL_WIDTH : 0);
  const isDataUploadView = activeView === "data-upload";

  useEffect(() => {
    if (!isQAPanel) {
      setIsQAHistoryOpen(false);
      setHistoryMenuConversationId(null);
    }
  }, [isQAPanel]);

  useEffect(() => {
    if (!isQAHistoryOpen) {
      setHistoryMenuConversationId(null);
    }
  }, [isQAHistoryOpen]);

  useEffect(() => {
    const handleDocPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-qa-history-menu]")) return;
      setHistoryMenuConversationId(null);
    };
    document.addEventListener("mousedown", handleDocPointerDown);
    return () => document.removeEventListener("mousedown", handleDocPointerDown);
  }, []);

  // 获取当前面板标题
  const getActivePanelTitle = () => {
    if (activeTool) return activeTool.name;

    const titles: Record<string, string> = {
      "data-upload": "管控资料上传",
      "qa-assistant": "管控问答助手",
      "approval-checklist": "管控审批清单",
    };
    return titles[activeView] || "未知面板";
  };

  const getConversationPreview = (messages: { content: string }[]) => {
    const latest = [...messages]
      .reverse()
      .find((message) => message.content && message.content.trim().length > 0);
    if (!latest) return "暂无对话内容";
    return latest.content.replace(/\s+/g, " ").trim();
  };

  // 处理右侧面板宽度调整
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      const clampedWidth = Math.max(360, Math.min(500, newWidth));
      setRightPanelWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
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
  }, [isResizing]);

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      {/* 左侧导航栏 */}
      <aside className="w-[200px] border-r border-border bg-card flex flex-col flex-shrink-0 min-h-0 overflow-hidden">
        {/* Logo */}
        <div className="h-12 border-b border-border flex items-center px-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
              <Building2 className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="text-xs font-medium leading-tight">高强度片区</p>
              <p className="text-xs font-medium leading-tight">数字化管控平台</p>
            </div>
          </div>
        </div>

        {/* 导航菜单 - 使用新的 SidebarNav 组件 */}
        <SidebarNav
          items={navigationWithTools}
          activeId={activeView}
          onNavigate={(id) => setActiveView(id as ActiveView)}
        />

        {/* 底部区域已按需求移除 */}
      </aside>

      {/* 主内容区 */}
      {/* 管控资料上传面板：用 hidden 隐藏而非卸载，避免切换视图时 CityScene 重新挂载导致模型闪烁 */}
      <section className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden ${isDataUploadView ? "" : "hidden"}`}>
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

      {/* 3D 场景主区域：始终挂载，避免切换视图时模型重新加载 */}
      <main className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden ${isDataUploadView ? "hidden" : ""}`}>
        {/* 顶部栏 */}
        <header className="h-12 border-b border-border bg-card flex items-center justify-end px-4 flex-shrink-0">
          <div className="flex items-center gap-4">
            {/* 视角控制 */}
            <ViewControls currentView={viewMode} onViewChange={setViewMode} />
            
            <div className="w-px h-6 bg-border" />
            
            {/* 模型上传 */}
            <ModelUploader
              onModelLoad={handleModelLoad}
              currentModel={externalModelUrl}
              currentModelName={externalModelName}
              onClearModel={handleClearModel}
            />


            <ThemeToggle />
          </div>
        </header>

        {/* 3D场景和错误标注 */}
        <div className="flex-1 min-h-0 relative isometric-grid overflow-hidden">
          <CityScene
            onSelectElement={(el) => {
              setSelectedElement(el);
              if (el) setSelectedImportedMesh(null);
            }}
            selectedElement={selectedElement}
            externalModelUrl={externalModelUrl}
            externalModelType={externalModelType}
            onModelError={setModelError}
            onImportedMeshSelect={(mesh) => {
              setSelectedImportedMesh(mesh);
              if (mesh) setSelectedElement(null);
            }}
            selectedImportedMesh={selectedImportedMesh}
            viewMode={viewMode}
            activeViewId={activeView}
            {...toolSceneProps}
            onModelBoundsComputed={(bounds) => {
              console.log('[page.tsx] onModelBoundsComputed:', bounds);
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
            onModelTransformComputed={(transform) => {
              setModelTransform(transform);
            }}
            onBuildingsExtracted={(buildings) => {
              console.log('[page.tsx] onBuildingsExtracted:', buildings.length);
              setModelBuildings(buildings);
            }}
          />

          {/* 选中元素的错误标注 - 仅在选中有问题的元素时显示 */}
          {selectedElement && selectedElement.controls.some(c => c.status === "exceeded") && (
            <div
              className="absolute bg-card border border-red-200 rounded-lg shadow-lg p-4 max-w-[300px]"
              style={{ right: "380px", top: "20px" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <XCircle className="h-5 w-5 text-red-500" />
                <span className="font-medium text-red-600">
                  管控报错
                </span>
              </div>
              <div className="space-y-3">
                {selectedElement.controls
                  .filter(c => c.status === "exceeded")
                  .map((control) => (
                    <div key={control.id} className="pb-2 border-b border-border last:border-0 last:pb-0">
                      <p className="text-sm font-medium text-red-600">{control.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        来源: {selectedElement.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        当前值: {control.currentValue}{control.unit}，限制值: {control.limitValue}{control.unit}
                      </p>
                      {control.suggestion && (
                        <p className="text-xs text-amber-600 mt-1">{control.suggestion}</p>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* 模型加载错误提示 */}
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

          {/* 选中元素信息 */}
          {selectedElement && (
            <div className="absolute bottom-4 left-4 bg-card border border-border rounded-lg shadow-lg p-4 max-w-[320px]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">{selectedElement.name}</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setSelectedElement(null)}
                >
                  关闭
                </Button>
              </div>
              <div className="space-y-2">
                {selectedElement.controls.slice(0, 3).map((control) => (
                  <div key={control.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{control.name}</span>
                    <div className="flex items-center gap-2">
                      <span>{control.currentValue}{control.unit}</span>
                      {control.status === "safe" && (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      {control.status === "exceeded" && (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      {control.status === "in-progress" && (
                        <Clock className="h-4 w-4 text-amber-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 选中导入对象信息 */}
          {selectedImportedMesh && (
            <div className="absolute bottom-4 left-4 bg-card border border-border rounded-lg shadow-lg p-4 max-w-[320px]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium">{selectedImportedMesh.name}</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setSelectedImportedMesh(null)}
                >
                  关闭
                </Button>
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
                <p className="text-xs text-muted-foreground pt-2 border-t border-border mt-2">
                  提示: 图层信息需要在 Rhino 导出时保留对象名称。建议将不同图层分别导出或使用 Python 后端处理 .3dm 文件以获取完整图层信息。
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 右侧详情面板 */}
      <aside
        className={`border-l border-border bg-card flex flex-col flex-shrink-0 min-h-0 overflow-hidden relative ${isDataUploadView ? "hidden" : ""}`}
        style={{ width: `${effectiveRightPanelWidth}px` }}
      >
        {/* 可拖拽的分隔条 */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 transition-colors z-10"
          onMouseDown={() => setIsResizing(true)}
          title="拖动调整宽度"
        />

        <div className="h-12 border-b border-border flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            {isQAPanel && <Sparkles className="h-4 w-4 text-blue-500" />}
            <h2 className="font-medium">{getActivePanelTitle()}</h2>
          </div>
          {isQAPanel && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-sm text-muted-foreground"
                title="新建对话"
                onClick={() => {
                  createQAConversation();
                  setIsQAHistoryOpen(false);
                }}
              >
                <SquarePen className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-sm text-muted-foreground"
                title="历史对话"
                onClick={() => setIsQAHistoryOpen((prev) => !prev)}
              >
                <PanelRight className={`h-4 w-4 ${isQAHistoryOpen ? "text-foreground" : ""}`} />
              </Button>
            </div>
          )}
        </div>

        <div
          className={cn(
            "relative flex-1 min-h-0",
            activeTool ? "overflow-auto p-4" : isQAPanel ? "overflow-hidden" : "overflow-auto"
          )}
        >
          {isQAPanel ? (
              <div className="flex h-full min-h-0">
              <div className="h-full min-w-0 flex flex-1 flex-col overflow-hidden">
                <QAPanel selectedElement={selectedElement} />
              </div>

              <aside
                className={cn(
                  "shrink-0 border-l border-border bg-card/95 backdrop-blur transition-[width,opacity] duration-200",
                  isQAHistoryOpen ? "w-72 opacity-100" : "w-0 border-l-0 opacity-0 pointer-events-none"
                )}
              >
                <div className="qa-scrollbar qa-scrollbar--no-gutter h-full space-y-1 overflow-y-auto py-2 pl-2 pr-1">
                  {qaConversations.map((conversation) => (
                    <div key={conversation.id} className="group relative w-full" data-qa-history-menu>
                      <button
                        type="button"
                        className={cn(
                          "w-full rounded-md border px-2 py-1.5 text-left transition-colors",
                          conversation.id === qaActiveConversationId
                            ? "border-primary/40 bg-primary/10"
                            : "border-border/60 bg-background/80 hover:bg-muted/40"
                        )}
                        onClick={() => {
                          switchQAConversation(conversation.id);
                          setIsQAHistoryOpen(false);
                        }}
                        title={conversation.title}
                      >
                        <div className="flex items-center gap-1">
                          {conversation.pinned && <Pin className="h-3 w-3 shrink-0 text-primary" />}
                          <p className="truncate text-xs font-medium text-foreground">{conversation.title}</p>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {getConversationPreview(conversation.messages)}
                        </p>
                      </button>

                      <button
                        type="button"
                        className={cn(
                          "absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-opacity hover:bg-muted",
                          historyMenuConversationId === conversation.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setHistoryMenuConversationId((prev) =>
                            prev === conversation.id ? null : conversation.id
                          );
                        }}
                        aria-label="更多操作"
                        data-qa-history-menu
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>

                      {historyMenuConversationId === conversation.id && (
                        <div
                          className="absolute right-1 top-7 z-20 min-w-[120px] rounded-md border border-border bg-popover p-1 shadow-lg"
                          data-qa-history-menu
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-popover-foreground hover:bg-muted"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              togglePinQAConversation(conversation.id);
                              setHistoryMenuConversationId(null);
                            }}
                          >
                            <Pin className="h-3.5 w-3.5" />
                            {conversation.pinned ? "取消置顶" : "置顶对话"}
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-popover-foreground hover:bg-muted"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const renamed = window.prompt("重命名对话", conversation.title);
                              if (renamed && renamed.trim()) {
                                renameQAConversation(conversation.id, renamed.trim());
                              }
                              setHistoryMenuConversationId(null);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            重命名
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const confirmed = window.confirm(`确认删除“${conversation.title}”？`);
                              if (confirmed) {
                                deleteQAConversation(conversation.id);
                              }
                              setHistoryMenuConversationId(null);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            删除对话
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          ) : (
            <div className="h-full min-h-0 overflow-auto">
              {activeView === "approval-checklist" && <ApprovalChecklistPanel />}
              {activeTool && (
                <ToolPanelWrapper tool={activeTool}>
                  {activeTool.Panel ? <activeTool.Panel /> : null}
                </ToolPanelWrapper>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}


