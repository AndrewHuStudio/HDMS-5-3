"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Sparkles, CheckSquare, Square, SquareX, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useExportChecklistStore } from "./store";
import { exportChecklistWord, generateAISuggestions } from "./api";
import { convertResultToStats } from "./utils";
import type { FeatureChecklistItem, DetailedStatistics } from "./types";
import {
  decreasePreviewZoom,
  increasePreviewZoom,
  PREVIEW_ZOOM_DEFAULT,
  PREVIEW_ZOOM_MAX,
  PREVIEW_ZOOM_MIN,
  resetPreviewZoom,
} from "./preview-zoom";
import { getSummaryTextClass } from "./summary-status";
import { resolveChecklistFeatureStatus, type ToolRunStatus } from "@/lib/tool-view-state";

function isSuggestionInvalid(value: string) {
  const normalized = value.trim();
  return (
    normalized.length === 0 ||
    normalized.includes("建议生成失败") ||
    normalized.includes("AI 建议生成失败")
  );
}

interface ExportChecklistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  features: Array<{
    id: string;
    name: string;
    checked: boolean;
    isPass: boolean;
    summary: string;
    rawResult: unknown;
  }>;
}

export function ExportChecklistDialog({
  open,
  onOpenChange,
  features,
}: ExportChecklistDialogProps) {
  const [aiProgress, setAiProgress] = useState({ completed: 0, total: 0 });
  const [previewZoom, setPreviewZoom] = useState(PREVIEW_ZOOM_DEFAULT);
  const [isExportingWord, setIsExportingWord] = useState(false);
  const {
    projectName,
    items,
    isGeneratingAI,
    setProjectName,
    setItems,
    updateItem,
    setIsGeneratingAI,
  } = useExportChecklistStore();

  const pageRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const itemPageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const featuresRef = useRef(features);
  featuresRef.current = features;

  const registerItemPageRef = useCallback((itemId: string, node: HTMLDivElement | null) => {
    if (node) {
      itemPageRefs.current[itemId] = node;
      return;
    }
    delete itemPageRefs.current[itemId];
  }, []);

  const handleJumpToItemPage = useCallback((itemId: string) => {
    const container = previewScrollRef.current;
    const targetPage = itemPageRefs.current[itemId];
    if (!container || !targetPage) return;

    const containerRect = container.getBoundingClientRect();
    const targetRect = targetPage.getBoundingClientRect();
    const nextTop = container.scrollTop + (targetRect.top - containerRect.top) - 16;
    container.scrollTo({ top: Math.max(nextTop, 0), behavior: "smooth" });
  }, []);

  // 初始化数据 — 仅在弹窗打开时触发，通过 ref 读取最新 features 避免引用不稳定问题
  useEffect(() => {
    if (open && featuresRef.current.length > 0) {
      setPreviewZoom(PREVIEW_ZOOM_DEFAULT);
      setAiProgress({ completed: 0, total: 0 });
      setIsExportingWord(false);
      const cachedItems = useExportChecklistStore.getState().items;
      const cachedById = new Map(cachedItems.map((item) => [item.id, item]));
      const initialItems: FeatureChecklistItem[] = featuresRef.current.map((f) => {
        const detailedStats = convertResultToStats(f.id, f.rawResult);
        const cached = cachedById.get(f.id);
        if (cached) {
          return {
            ...cached,
            name: f.name,
            isPass: f.isPass,
            summary: f.summary,
            detailedStats,
            rawResult: f.rawResult,
          };
        }
        return {
          id: f.id,
          name: f.name,
          isPass: f.isPass,
          summary: f.summary,
          detailedStats,
          rawResult: f.rawResult,
          aiSuggestion: "",
          isGeneratingAI: false,
          aiGenerationStatus: "idle",
          showAiSuggestion: true,
          govSuggestion: "",
        };
      });
      setItems(initialItems);
    }
  }, [open]);

  // 批量生成 AI 建议并直接覆盖“审查方建议”
  const handleGenerateAllAI = async () => {
    if (isGeneratingAI) return;

    const targetItems = [...items];
    if (targetItems.length === 0) {
      return;
    }

    setIsGeneratingAI(true);
    setAiProgress({ completed: 0, total: targetItems.length });
    setItems(
      targetItems.map((item) => ({
        ...item,
        isGeneratingAI: true,
        aiGenerationStatus: "generating",
      }))
    );

    try {
      const response = await generateAISuggestions({
        features: targetItems.map((item) => ({
          id: item.id,
          name: item.name,
          summary: item.summary,
          raw_result: item.rawResult,
        })),
      });

      const suggestionMap = new Map(
        response.suggestions.map((suggestion) => [suggestion.id, suggestion.suggestion.trim()])
      );
      const failedItems: string[] = [];

      setItems(
        targetItems.map((item) => {
          const suggestionText = suggestionMap.get(item.id) ?? "";
          if (isSuggestionInvalid(suggestionText)) {
            failedItems.push(item.name);
            return {
              ...item,
              isGeneratingAI: false,
              aiGenerationStatus: "failed" as const,
            };
          }
          return {
            ...item,
            govSuggestion: suggestionText,
            isGeneratingAI: false,
            aiGenerationStatus: "done" as const,
          };
        })
      );
      setAiProgress({ completed: targetItems.length, total: targetItems.length });

      if (failedItems.length > 0) {
        const preview = failedItems.slice(0, 3).join("、");
        const tail = failedItems.length > 3 ? ` 等 ${failedItems.length} 项` : "";
        alert(`部分项目生成失败：${preview}${tail}，已保留原审查方建议。`);
      }
    } catch (error) {
      console.error("批量生成失败:", error);
      alert(`生成失败: ${error instanceof Error ? error.message : "未知错误"}`);
      setItems(
        targetItems.map((item) => ({
          ...item,
          isGeneratingAI: false,
          aiGenerationStatus: "failed",
        }))
      );
      setAiProgress({ completed: targetItems.length, total: targetItems.length });
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // 导出 Word
  const handleExportWord = async () => {
    if (isExportingWord) return;

    try {
      setIsExportingWord(true);
      const fileName = `${projectName || "审核清单"}_${new Date().toISOString().slice(0, 10)}`;
      const wordBlob = await exportChecklistWord({
        project_name: projectName || "审核清单",
        file_name: fileName,
        exported_date: new Date().toLocaleDateString("zh-CN"),
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          is_pass: item.isPass,
          summary: item.summary,
          detailed_stats: item.detailedStats,
          gov_suggestion: item.govSuggestion,
        })),
      });

      const downloadUrl = URL.createObjectURL(wordBlob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `${fileName}.docx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Word 导出失败:", error);
      alert(`Word 导出失败: ${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setIsExportingWord(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] sm:max-w-[90vw] h-[90vh] p-0 flex flex-col z-[2147483647]">
        <DialogHeader className="px-6 py-3 border-b flex flex-row items-center justify-between">
          <DialogTitle>管控审核清单导出</DialogTitle>
          <div className="flex items-center gap-2 mr-8">
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => setPreviewZoom((current) => decreasePreviewZoom(current))}
              disabled={previewZoom <= PREVIEW_ZOOM_MIN}
              aria-label="缩小预览"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-16 text-center text-sm text-gray-700">{previewZoom}%</span>
            <Button
              type="button"
              variant="outline"
              className="h-9 px-3"
              onClick={() => setPreviewZoom(resetPreviewZoom())}
              disabled={previewZoom === PREVIEW_ZOOM_DEFAULT}
            >
              重置
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => setPreviewZoom((current) => increasePreviewZoom(current))}
              disabled={previewZoom >= PREVIEW_ZOOM_MAX}
              aria-label="放大预览"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* 中间栏 - A4 预览 */}
          <MiddlePreview
            projectName={projectName}
            items={items}
            onUpdateGovSuggestion={(id, text) => updateItem(id, { govSuggestion: text })}
            pageRef={pageRef}
            scrollContainerRef={previewScrollRef}
            onRegisterItemPageRef={registerItemPageRef}
            previewZoom={previewZoom}
          />

          {/* 右侧栏 - 功能按钮 */}
          <RightActions
            projectName={projectName}
            onProjectNameChange={setProjectName}
            features={features.map(f => ({
              id: f.id,
              name: f.name,
              status: resolveChecklistFeatureStatus(f.checked, f.isPass),
            }))}
            isGeneratingAI={isGeneratingAI}
            isExportingWord={isExportingWord}
            aiProgress={aiProgress}
            onGenerateAllAI={handleGenerateAllAI}
            onExportWord={handleExportWord}
            onJumpToItemPage={handleJumpToItemPage}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// A4 页面样式常量
const A4_STYLE: React.CSSProperties = {
  width: "794px",
  minHeight: "1123px",
  padding: "60px",
  fontFamily: "SimSun, serif",
};

// 中间栏组件 - Word 式分页效果
function MiddlePreview({
  projectName,
  items,
  onUpdateGovSuggestion,
  pageRef,
  scrollContainerRef,
  onRegisterItemPageRef,
  previewZoom,
}: {
  projectName: string;
  items: FeatureChecklistItem[];
  onUpdateGovSuggestion: (id: string, text: string) => void;
  pageRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onRegisterItemPageRef: (itemId: string, node: HTMLDivElement | null) => void;
  previewZoom: number;
}) {
  const date = new Date().toLocaleDateString("zh-CN");
  const previewScale = previewZoom / 100;

  return (
    <div className="flex-1 min-h-0 bg-gray-100 flex flex-col">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto" style={{ width: `${794 * previewScale}px` }}>
          <div style={{ zoom: previewScale }}>
            {/* 使用 space-y-6 在多个 A4 页面之间创建间隙，模拟 Word 分页效果 */}
            <div ref={pageRef} className="space-y-6" style={{ width: "794px" }}>
              {/* 第 1 页：封面 */}
              <div className="bg-white shadow-lg" style={A4_STYLE}>
                {/* 封面标题 */}
                <div className="text-center mb-6">
                  <h1 className="text-2xl font-bold mb-2">
                    {projectName || "____"}管控审核清单
                  </h1>
                  <p className="text-sm text-gray-600">日期：{date}</p>
                </div>
                <div className="border-t-2 border-gray-800 mb-6" />

                {/* 检测项目录表格 */}
                <div className="mb-6">
                  <h2 className="text-base font-semibold mb-3">检测项目录</h2>
                  {items.length === 0 ? (
                    <div className="text-center text-gray-500 py-8">暂无检测数据</div>
                  ) : (
                    <table className="w-full text-sm border-collapse border border-gray-300">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="border border-gray-300 px-3 py-2 text-left w-12">序号</th>
                          <th className="border border-gray-300 px-3 py-2 text-left">检测项</th>
                          <th className="border border-gray-300 px-3 py-2 text-center w-32">检测结果</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, index) => (
                          <tr key={item.id}>
                            <td className="border border-gray-300 px-3 py-1.5 text-center">{index + 1}</td>
                            <td className="border border-gray-300 px-3 py-1.5">{item.name}</td>
                            <td className={`border border-gray-300 px-3 py-1.5 text-center text-xs ${getSummaryTextClass(
                              item.summary,
                              item.isPass
                            )}`}>
                              {item.summary}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* 第 2~N 页：每个检测项一页 */}
              {items.map((item, index) => (
                <div
                  key={item.id}
                  ref={(node) => onRegisterItemPageRef(item.id, node)}
                  className="bg-white shadow-lg"
                  style={A4_STYLE}
                >
                  {/* 页眉 */}
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-4 pb-2 border-b border-gray-200">
                    <span>{projectName || "____"}管控审核清单</span>
                    <span>第 {index + 2} 页</span>
                  </div>

                  <ChecklistItemDetail
                    item={item}
                    index={index}
                    onUpdateGovSuggestion={(text) => onUpdateGovSuggestion(item.id, text)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 检测项详情组件
function ChecklistItemDetail({
  item,
  index,
  onUpdateGovSuggestion,
}: {
  item: FeatureChecklistItem;
  index: number;
  onUpdateGovSuggestion: (text: string) => void;
}) {
  const isQueued = item.aiGenerationStatus === "queued";
  const isGenerating = item.aiGenerationStatus === "generating";
  const isFailed = item.aiGenerationStatus === "failed";
  const overlayMessage = isGenerating ? "正在生成建议..." : "待开始，请稍等...";
  const suggestionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = suggestionRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [item.govSuggestion]);

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <h2 className="text-lg font-semibold">
        {index + 1}. {item.name}
      </h2>

      {/* 详细统计 */}
      {item.detailedStats ? (
        <DetailedStatisticsView stats={item.detailedStats} />
      ) : (
        <div className="text-sm text-gray-700 pl-4">
          <p>{item.summary}</p>
        </div>
      )}

      {/* 审查方建议 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">审查方建议：</label>
        <div className="relative">
          <Textarea
            ref={suggestionRef}
            value={item.govSuggestion}
            onChange={(e) => {
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
              onUpdateGovSuggestion(e.target.value);
            }}
            disabled={isQueued || isGenerating}
            placeholder={
              isGenerating
                ? "正在生成建议..."
                : isQueued
                ? "待开始，请稍等..."
                : "请输入审查方建议..."
            }
            rows={1}
            className="min-h-[80px] resize-none overflow-hidden text-sm"
          />
          {(isQueued || isGenerating) && (
            <div className="absolute inset-0 rounded-md bg-white/75 flex items-center justify-center pointer-events-none">
              <span className="inline-flex items-center text-sm text-gray-600">
                <Loader2 className={`h-4 w-4 mr-2 ${isGenerating ? "animate-spin" : "animate-pulse"}`} />
                <span className="animate-pulse">{overlayMessage}</span>
              </span>
            </div>
          )}
        </div>
        {isFailed && (
          <p className="text-xs text-red-500">生成失败，请重试一键填充。</p>
        )}
      </div>
    </div>
  );
}

// 详细统计展示组件 — 表格形式
function DetailedStatisticsView({ stats }: { stats: DetailedStatistics }) {
  const hasPassedPlots = stats.passed.plots.length > 0;
  const hasFailedItems = stats.failed.items.length > 0;

  // 如果既没有通过也没有不通过的详细数据，只显示 summary
  if (!hasPassedPlots && !hasFailedItems && stats.passed.totalBuildings === 0 && stats.failed.totalBuildings === 0) {
    return (
      <div className="text-sm">
        <p className="text-gray-600">{stats.summary}</p>
      </div>
    );
  }

  return (
    <div className="text-sm space-y-3">
      {/* 通过项表格 */}
      {(hasPassedPlots || stats.passed.totalBuildings > 0) && (
        <div>
          <p className="font-medium text-green-700 mb-1">通过项（{stats.passed.totalBuildings} 栋）</p>
          {hasPassedPlots ? (
            <table className="w-full border-collapse border border-gray-300">
              <thead>
                <tr className="bg-green-50">
                  <th className="border border-gray-300 px-2 py-1 text-left w-10">序号</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">地块</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">建筑</th>
                </tr>
              </thead>
              <tbody>
                {stats.passed.plots.map((plot, idx) => (
                  <tr key={idx}>
                    <td className="border border-gray-300 px-2 py-1 text-center">{idx + 1}</td>
                    <td className="border border-gray-300 px-2 py-1">{plot.name}</td>
                    <td className="border border-gray-300 px-2 py-1">{plot.buildings.join("、")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-gray-600 text-xs">共 {stats.passed.totalBuildings} 项通过</p>
          )}
        </div>
      )}

      {/* 不通过项表格 */}
      {(hasFailedItems || stats.failed.totalBuildings > 0) && (
        <div>
          <p className="font-medium text-red-700 mb-1">不通过项（{stats.failed.totalBuildings} 栋）</p>
          {hasFailedItems ? (
            <table className="w-full border-collapse border border-gray-300">
              <thead>
                <tr className="bg-red-50">
                  <th className="border border-gray-300 px-2 py-1 text-left w-10">序号</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">地块</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">建筑/对象</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">问题</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">详情</th>
                </tr>
              </thead>
              <tbody>
                {stats.failed.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="border border-gray-300 px-2 py-1 text-center">{idx + 1}</td>
                    <td className="border border-gray-300 px-2 py-1">{item.plotName}</td>
                    <td className="border border-gray-300 px-2 py-1">{item.buildingName}</td>
                    <td className="border border-gray-300 px-2 py-1">{item.issue}</td>
                    <td className="border border-gray-300 px-2 py-1 text-xs">{item.details || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-gray-600 text-xs">共 {stats.failed.totalBuildings} 项不通过</p>
          )}
        </div>
      )}

      {/* 总计 */}
      <div className="bg-gray-50 px-3 py-2 rounded text-gray-700 font-medium">
        {stats.summary}
      </div>
    </div>
  );
}

// 右侧功能按钮区
function RightActions({
  projectName,
  onProjectNameChange,
  features,
  isGeneratingAI,
  isExportingWord,
  aiProgress,
  onGenerateAllAI,
  onExportWord,
  onJumpToItemPage,
}: {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  features: Array<{ id: string; name: string; status: ToolRunStatus }>;
  isGeneratingAI: boolean;
  isExportingWord: boolean;
  aiProgress: { completed: number; total: number };
  onGenerateAllAI: () => void;
  onExportWord: () => void;
  onJumpToItemPage: (itemId: string) => void;
}) {
  return (
    <div className="w-[280px] border-l flex flex-col p-4 overflow-y-auto">
      <div className="mb-4">
        <label className="text-sm font-medium mb-2 block">项目名称</label>
        <Input
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          placeholder="请输入项目名称"
        />
      </div>

      <div className="mb-4">
        <h3 className="font-semibold mb-3 text-sm">管控审批清单</h3>
        <div className="space-y-2">
          {features.map((feature) => (
            <button
              key={feature.id}
              type="button"
              onClick={() => onJumpToItemPage(feature.id)}
              className="w-full flex items-center gap-2 text-sm py-1.5 text-left rounded-sm hover:bg-muted/60 transition-colors cursor-pointer"
            >
              {feature.status === "pass" ? (
                <CheckSquare className="h-4 w-4 text-green-600" />
              ) : feature.status === "fail" ? (
                <SquareX className="h-4 w-4 text-red-600" />
              ) : (
                <Square className="h-4 w-4 text-gray-400" />
              )}
              <span className={feature.status === "idle" ? "text-muted-foreground" : ""}>
                {feature.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <h3 className="font-semibold mb-4 text-sm">功能选项</h3>

      <div className="space-y-3 mb-4">
        {/* 一键生成 AI 建议 */}
        <Button
          variant="outline"
          className="w-full cursor-pointer"
          onClick={onGenerateAllAI}
          disabled={isGeneratingAI}
        >
          {isGeneratingAI ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              生成中（{aiProgress.completed}/{aiProgress.total || features.length}）
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              一键填充审查方建议
            </>
          )}
        </Button>

        {/* 导出 Word */}
        <Button
          className="w-full cursor-pointer"
          onClick={onExportWord}
          disabled={isExportingWord}
        >
          {isExportingWord ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              导出中...
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              导出 Word
            </>
          )}
        </Button>
      </div>

      {/* 提示信息 */}
      <div className="mt-6 text-xs text-muted-foreground space-y-2">
        <p>使用提示：</p>
        <ul className="list-disc list-inside space-y-1">
          <li>可一键填充审查方建议</li>
          <li>填写审查方建议</li>
          <li>最后导出Word</li>
        </ul>
      </div>
    </div>
  );
}
