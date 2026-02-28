"use client";

import { useState, useEffect, useRef } from "react";
import { Download, Loader2, Sparkles, Camera, CheckSquare, Square } from "lucide-react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useExportChecklistStore } from "./store";
import { generateAISuggestions } from "./api";
import { convertResultToStats } from "./utils";
import type { FeatureChecklistItem, DetailedStatistics } from "./types";

interface ExportChecklistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  features: Array<{
    id: string;
    name: string;
    summary: string;
    rawResult: unknown;
  }>;
}

export function ExportChecklistDialog({
  open,
  onOpenChange,
  features,
}: ExportChecklistDialogProps) {
  const {
    projectName,
    items,
    isGeneratingAI,
    isCapturingScreenshot,
    setProjectName,
    setItems,
    updateItem,
    updateItemStats,
    setIsGeneratingAI,
    setIsCapturingScreenshot,
    reset,
  } = useExportChecklistStore();

  const [screenshot, setScreenshot] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // 初始化数据
  useEffect(() => {
    if (open && features.length > 0) {
      const initialItems: FeatureChecklistItem[] = features.map((f) => {
        const detailedStats = convertResultToStats(f.id, f.rawResult);
        return {
          id: f.id,
          name: f.name,
          screenshot: null,
          summary: f.summary,
          detailedStats,
          rawResult: f.rawResult,
          aiSuggestion: "",
          isGeneratingAI: false,
          showAiSuggestion: true,
          govSuggestion: "",
        };
      });
      setItems(initialItems);
      // 移除自动截图
    }
  }, [open, features]);

  // 手动截图函数
  const handleCaptureScreenshot = async () => {
    setIsCapturingScreenshot(true);

    try {
      const canvas = document.querySelector("canvas");
      if (!canvas) {
        alert("未找到 3D 场景，请确保模型已加载");
        return;
      }

      const screenshotCanvas = await html2canvas(canvas, {
        backgroundColor: "#f0f0f0",
        scale: 1,
      });

      const dataUrl = screenshotCanvas.toDataURL("image/png");
      setScreenshot(dataUrl);

      // 更新所有 items 的截图
      setItems(items.map(item => ({ ...item, screenshot: dataUrl })));

    } catch (error) {
      console.error("截图失败:", error);
      alert(`截图失败: ${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setIsCapturingScreenshot(false);
    }
  };

  // 单个生成 AI 建议
  const handleGenerateSingleAI = async (featureId: string) => {
    const item = items.find(i => i.id === featureId);
    if (!item) return;

    updateItem(featureId, { isGeneratingAI: true });

    try {
      const response = await generateAISuggestions({
        features: [{
          id: item.id,
          name: item.name,
          summary: item.summary,
          raw_result: item.rawResult,
        }],
      });

      const suggestion = response.suggestions.find(s => s.id === featureId);
      if (suggestion) {
        updateItem(featureId, {
          aiSuggestion: suggestion.suggestion,
          isGeneratingAI: false
        });
      }
    } catch (error) {
      console.error(`生成 AI 建议失败:`, error);
      alert(`生成失败: ${error instanceof Error ? error.message : "未知错误"}`);
      updateItem(featureId, { isGeneratingAI: false });
    }
  };

  // 批量生成 AI 建议
  const handleGenerateAllAI = async () => {
    setIsGeneratingAI(true);

    items.forEach(item => {
      updateItem(item.id, { isGeneratingAI: true });
    });

    try {
      const response = await generateAISuggestions({
        features: items.map(item => ({
          id: item.id,
          name: item.name,
          summary: item.summary,
          raw_result: item.rawResult,
        })),
      });

      response.suggestions.forEach(suggestion => {
        updateItem(suggestion.id, {
          aiSuggestion: suggestion.suggestion,
          isGeneratingAI: false
        });
      });
    } catch (error) {
      console.error("批量生成失败:", error);
      alert(`生成失败: ${error instanceof Error ? error.message : "未知错误"}`);
      items.forEach(item => {
        updateItem(item.id, { isGeneratingAI: false });
      });
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // 导出 PDF
  const handleExportPDF = async () => {
    if (!pageRef.current) return;

    try {
      // 截取页面内容
      const canvas = await html2canvas(pageRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
      const imgX = (pdfWidth - imgWidth * ratio) / 2;
      const imgY = 0;

      pdf.addImage(
        imgData,
        "PNG",
        imgX,
        imgY,
        imgWidth * ratio,
        imgHeight * ratio
      );

      const fileName = `${projectName || "审核清单"}_${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(fileName);
    } catch (error) {
      console.error("PDF 导出失败:", error);
      alert(`PDF 导出失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 flex flex-col">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle>管控审核清单导出</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* 左侧栏 - 管控审批清单 */}
          <LeftSidebar
            projectName={projectName}
            onProjectNameChange={setProjectName}
            features={features.map(f => ({
              id: f.id,
              name: f.name,
              checked: true,
            }))}
          />

          {/* 中间栏 - A4 预览 */}
          <MiddlePreview
            projectName={projectName}
            items={items}
            screenshot={screenshot}
            onGenerateSingleAI={handleGenerateSingleAI}
            onUpdateGovSuggestion={(id, text) => updateItem(id, { govSuggestion: text })}
            pageRef={pageRef}
          />

          {/* 右侧栏 - 功能按钮 */}
          <RightActions
            isCapturingScreenshot={isCapturingScreenshot}
            isGeneratingAI={isGeneratingAI}
            onCaptureScreenshot={handleCaptureScreenshot}
            onGenerateAllAI={handleGenerateAllAI}
            onExportPDF={handleExportPDF}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 左侧栏组件
function LeftSidebar({
  projectName,
  onProjectNameChange,
  features,
}: {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  features: Array<{ id: string; name: string; checked: boolean }>;
}) {
  return (
    <div className="w-[280px] border-r flex flex-col">
      {/* 项目名称 */}
      <div className="p-4 border-b">
        <label className="text-sm font-medium mb-2 block">项目名称</label>
        <Input
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          placeholder="请输入项目名称"
        />
        <div className="text-xs text-muted-foreground mt-1">
          管控审核清单
        </div>
      </div>

      {/* 检测项列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="font-semibold mb-3 text-sm">管控审批清单</h3>
        <div className="space-y-2">
          {features.map((feature) => (
            <div
              key={feature.id}
              className="flex items-center gap-2 text-sm py-1.5"
            >
              {feature.checked ? (
                <CheckSquare className="h-4 w-4 text-green-600" />
              ) : (
                <Square className="h-4 w-4 text-gray-400" />
              )}
              <span className={feature.checked ? "" : "text-muted-foreground"}>
                {feature.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 中间栏组件
function MiddlePreview({
  projectName,
  items,
  screenshot,
  onGenerateSingleAI,
  onUpdateGovSuggestion,
  pageRef,
}: {
  projectName: string;
  items: FeatureChecklistItem[];
  screenshot: string | null;
  onGenerateSingleAI: (id: string) => void;
  onUpdateGovSuggestion: (id: string, text: string) => void;
  pageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const date = new Date().toLocaleDateString("zh-CN");

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
      <div
        ref={pageRef}
        className="bg-white mx-auto shadow-lg"
        style={{
          width: "210mm",
          minHeight: "297mm",
          padding: "20mm",
          fontFamily: "SimSun, serif",
        }}
      >
        {/* 标题 */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-2">
            {projectName || "____"}管控审核清单
          </h1>
          <p className="text-sm text-gray-600">日期：{date}</p>
        </div>

        {/* 分隔线 */}
        <div className="border-t-2 border-gray-800 mb-6" />

        {/* 检测项列表 */}
        <div className="space-y-8">
          {items.map((item, index) => (
            <ChecklistItemDetail
              key={item.id}
              item={item}
              index={index}
              screenshot={screenshot}
              onGenerateAI={() => onGenerateSingleAI(item.id)}
              onUpdateGovSuggestion={(text) => onUpdateGovSuggestion(item.id, text)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// 检测项详情组件
function ChecklistItemDetail({
  item,
  index,
  screenshot,
  onGenerateAI,
  onUpdateGovSuggestion,
}: {
  item: FeatureChecklistItem;
  index: number;
  screenshot: string | null;
  onGenerateAI: () => void;
  onUpdateGovSuggestion: (text: string) => void;
}) {
  return (
    <div className="space-y-3">
      {/* 标题 */}
      <h2 className="text-lg font-semibold">
        {index + 1}. {item.name}
      </h2>

      {/* 渲染图 */}
      {screenshot && (
        <div className="flex justify-center">
          <img
            src={screenshot}
            alt={`${item.name}渲染图`}
            className="w-[280px] h-[180px] object-cover border rounded"
          />
        </div>
      )}

      {/* 详细统计 */}
      {item.detailedStats ? (
        <DetailedStatisticsView stats={item.detailedStats} />
      ) : (
        <div className="text-sm text-gray-700 pl-4">
          <p>{item.summary}</p>
        </div>
      )}

      {/* AI 建议 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onGenerateAI}
            disabled={item.isGeneratingAI}
          >
            {item.isGeneratingAI ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3 mr-1" />
                生成 AI 建议
              </>
            )}
          </Button>
        </div>
        {item.aiSuggestion && (
          <div className="text-sm text-gray-700 pl-4 bg-blue-50 p-3 rounded">
            <p className="font-medium mb-1">AI 建议：</p>
            <p>{item.aiSuggestion}</p>
          </div>
        )}
      </div>

      {/* 审查方建议 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">审查方建议：</label>
        <Textarea
          value={item.govSuggestion}
          onChange={(e) => onUpdateGovSuggestion(e.target.value)}
          placeholder="请输入审查方建议..."
          className="min-h-[80px] text-sm"
        />
      </div>
    </div>
  );
}

// 详细统计展示组件
function DetailedStatisticsView({ stats }: { stats: DetailedStatistics }) {
  return (
    <div className="text-sm space-y-3 pl-4">
      <p className="font-medium">检测结果详细统计：</p>

      {/* 通过项 */}
      {stats.passed.totalBuildings > 0 && (
        <div>
          <div className="flex items-start gap-2">
            <span className="text-green-600">✓</span>
            <div className="flex-1">
              <span className="font-medium">通过地块：</span>
              <div className="mt-1 space-y-1">
                {stats.passed.plots.map((plot, idx) => (
                  <div key={idx} className="text-gray-700">
                    - {plot.name} ({plot.buildings.join("、")})
                  </div>
                ))}
              </div>
              <div className="mt-1 text-gray-600">
                共 {stats.passed.totalPlots} 个地块，{stats.passed.totalBuildings} 栋建筑通过
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 不通过项 */}
      {stats.failed.totalBuildings > 0 && (
        <div>
          <div className="flex items-start gap-2">
            <span className="text-red-600">✗</span>
            <div className="flex-1">
              <span className="font-medium">{stats.failed.items[0]?.issue || "不通过"}地块：</span>
              <div className="mt-1 space-y-1">
                {stats.failed.items.map((item, idx) => (
                  <div key={idx} className="text-gray-700">
                    - {item.plotName}：{item.buildingName}
                    {item.details && (
                      <span className="text-gray-600 ml-1">({item.details})</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-1 text-gray-600">
                共 {stats.failed.totalPlots} 个地块，{stats.failed.totalBuildings} 栋建筑不通过
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 总计 */}
      <div className="pt-2 border-t border-gray-200">
        <span className="font-medium">总计：</span>
        <span className="text-gray-700">{stats.summary}</span>
      </div>
    </div>
  );
}

// 右侧功能按钮区
function RightActions({
  isCapturingScreenshot,
  isGeneratingAI,
  onCaptureScreenshot,
  onGenerateAllAI,
  onExportPDF,
}: {
  isCapturingScreenshot: boolean;
  isGeneratingAI: boolean;
  onCaptureScreenshot: () => void;
  onGenerateAllAI: () => void;
  onExportPDF: () => void;
}) {
  return (
    <div className="w-[200px] border-l flex flex-col p-4">
      <h3 className="font-semibold mb-4 text-sm">功能选项</h3>

      <div className="space-y-3">
        {/* 加载截图 */}
        <Button
          variant="outline"
          className="w-full"
          onClick={onCaptureScreenshot}
          disabled={isCapturingScreenshot}
        >
          {isCapturingScreenshot ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              截图中...
            </>
          ) : (
            <>
              <Camera className="h-4 w-4 mr-2" />
              加载截图
            </>
          )}
        </Button>

        {/* 一键生成 AI 建议 */}
        <Button
          variant="outline"
          className="w-full"
          onClick={onGenerateAllAI}
          disabled={isGeneratingAI}
        >
          {isGeneratingAI ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              一键生成AI建议
            </>
          )}
        </Button>

        {/* 导出 PDF */}
        <Button
          className="w-full"
          onClick={onExportPDF}
        >
          <Download className="h-4 w-4 mr-2" />
          导出 PDF
        </Button>
      </div>

      {/* 提示信息 */}
      <div className="mt-6 text-xs text-muted-foreground space-y-2">
        <p>使用提示：</p>
        <ul className="list-disc list-inside space-y-1">
          <li>先加载截图</li>
          <li>可选择生成AI建议</li>
          <li>填写审查方建议</li>
          <li>最后导出PDF</li>
        </ul>
      </div>
    </div>
  );
}
