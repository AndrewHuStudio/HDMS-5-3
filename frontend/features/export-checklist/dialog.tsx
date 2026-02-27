"use client";

import { useState, useEffect, useRef } from "react";
import { Download, Loader2, Sparkles } from "lucide-react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useExportChecklistStore } from "./store";
import { ChecklistPage } from "./checklist-page";
import { generateAISuggestions } from "./api";
import type { FeatureChecklistItem } from "./types";

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
    setProjectName,
    setItems,
    updateItem,
    setIsGeneratingAI,
    reset,
  } = useExportChecklistStore();

  const [screenshot, setScreenshot] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // 初始化数据
  useEffect(() => {
    if (open && features.length > 0) {
      const initialItems: FeatureChecklistItem[] = features.map((f) => ({
        id: f.id,
        name: f.name,
        screenshot: null,
        summary: f.summary,
        rawResult: f.rawResult,
        aiSuggestion: "",
        showAiSuggestion: true,
        govSuggestion: "",
      }));
      setItems(initialItems);
      captureScreenshot();
    }
  }, [open, features]);

  // 截图函数
  const captureScreenshot = async () => {
    try {
      // 查找 Three.js canvas
      const canvas = document.querySelector("canvas");
      if (!canvas) {
        console.warn("未找到 Three.js canvas");
        return;
      }

      // 使用 html2canvas 截图
      const screenshotCanvas = await html2canvas(canvas, {
        backgroundColor: "#f0f0f0",
        scale: 1,
      });

      const dataUrl = screenshotCanvas.toDataURL("image/png");
      setScreenshot(dataUrl);

      // 为所有 items 设置截图
      setItems(
        items.map((item) => ({
          ...item,
          screenshot: dataUrl,
        }))
      );
    } catch (error) {
      console.error("截图失败:", error);
    }
  };

  // 生成 AI 建议
  const handleGenerateAI = async () => {
    setIsGeneratingAI(true);
    try {
      const response = await generateAISuggestions({
        features: items.map((item) => ({
          id: item.id,
          name: item.name,
          summary: item.summary,
          raw_result: item.rawResult,
        })),
      });

      response.suggestions.forEach((suggestion) => {
        updateItem(suggestion.id, { aiSuggestion: suggestion.suggestion });
      });
    } catch (error) {
      console.error("AI 建议生成失败:", error);
      alert(`AI 建议生成失败: ${error instanceof Error ? error.message : "未知错误"}`);
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>管控审核清单导出</DialogTitle>
        </DialogHeader>

        {/* 项目名称输入 */}
        <div className="flex items-center gap-2 px-4">
          <span className="text-sm font-medium whitespace-nowrap">项目名称:</span>
          <Input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="请输入项目名称"
            className="flex-1"
          />
          <span className="text-sm whitespace-nowrap">管控审核清单</span>
        </div>

        {/* 预览区域 */}
        <div className="flex-1 overflow-y-auto border rounded-md p-4 bg-gray-50">
          <div ref={pageRef}>
            <ChecklistPage
              projectName={projectName}
              items={items.map((item) => ({
                ...item,
                screenshot: screenshot,
              }))}
            />
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <Button
            variant="outline"
            onClick={handleGenerateAI}
            disabled={isGeneratingAI}
          >
            {isGeneratingAI ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            生成 AI 建议
          </Button>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={handleExportPDF}>
              <Download className="h-4 w-4 mr-2" />
              导出 PDF
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
