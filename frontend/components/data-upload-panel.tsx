/**
 * 数据上传面板组件
 * 管理 OCR 扫描、向量化处理、图谱化处理、验证检查四个阶段的数据上传流程，
 * 展示各阶段的处理进度和状态。
 */
"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Database, FileSearch2, Layers3 } from "lucide-react";
import { OCRUploadPanel } from "@/features/data-upload/ocr-upload-panel";
import { VectorUploadPanel } from "@/features/data-upload/vector-upload-panel";
import { GraphUploadPanel } from "@/features/data-upload/graph-upload-panel";
import { VerificationPanel } from "@/features/data-upload/verification-panel";

const processSections = [
  {
    id: 1,
    title: "OCR 扫描",
    subtitle: "",
    icon: FileSearch2,
    hints: ["支持 PDF / 图片批量上传", "展示 OCR 识别进度与结果摘要", "预留文档纠错与重试入口"],
  },
  {
    id: 2,
    title: "向量化处理",
    subtitle: "",
    icon: Database,
    hints: ["展示分块策略与处理批次信息", "展示向量化状态与入库统计", "预留向量库索引配置入口"],
  },
  {
    id: 3,
    title: "图谱化处理",
    subtitle: "",
    icon: Layers3,
    hints: ["展示实体/关系抽取数量", "展示图谱构建任务进度", "预留图谱校验与导出入口"],
  },
  {
    id: 4,
    title: "一键校验",
    subtitle: "",
    icon: CheckCircle2,
    hints: ["集中显示 OCR、向量、图谱处理统计", "展示任务总耗时与异常概览", "预留一键导出处理报告入口"],
  },
] as const;

export function DataUploadPanel() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
        {processSections.map((section) => {
          const SectionIcon = section.icon;
          return (
            <Card key={section.id} className="min-h-[320px] border-border/80">
              <CardHeader className="pb-0">
                <div className="flex flex-wrap items-start justify-between gap-1">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge className="h-6 px-2 text-xs">步骤 {section.id}</Badge>
                      <CardTitle className="text-lg">{section.title}</CardTitle>
                    </div>
                    {section.subtitle && <CardDescription>{section.subtitle}</CardDescription>}
                  </div>
                  <div className="rounded-lg border border-border bg-muted/40 p-2 text-muted-foreground -mt-1">
                    <SectionIcon className="h-5 w-5" />
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {section.id === 1 ? (
                  <OCRUploadPanel />
                ) : section.id === 2 ? (
                  <VectorUploadPanel />
                ) : section.id === 3 ? (
                  <GraphUploadPanel />
                ) : (
                  <VerificationPanel />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
