"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Database, FileSearch2, Layers3, PlayCircle } from "lucide-react";

const processSections = [
  {
    id: 1,
    title: "OCR 扫描",
    subtitle: "读取并识别上传资料中的文本与结构",
    icon: FileSearch2,
    hints: ["支持 PDF / 图片批量上传", "展示 OCR 识别进度与结果摘要", "预留文档纠错与重试入口"],
  },
  {
    id: 2,
    title: "向量化处理",
    subtitle: "分块、嵌入与向量入库的处理阶段",
    icon: Database,
    hints: ["展示分块策略与处理批次信息", "展示向量化状态与入库统计", "预留向量库索引配置入口"],
  },
  {
    id: 3,
    title: "图谱化处理",
    subtitle: "实体关系抽取与知识图谱构建阶段",
    icon: Layers3,
    hints: ["展示实体/关系抽取数量", "展示图谱构建任务进度", "预留图谱校验与导出入口"],
  },
  {
    id: 4,
    title: "一键校验",
    subtitle: "汇总全流程处理结果，形成统一校验视图",
    icon: CheckCircle2,
    hints: ["集中显示 OCR、向量、图谱处理统计", "展示任务总耗时与异常概览", "预留一键导出处理报告入口"],
  },
] as const;

export function DataUploadPanel() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs">管控资料上传</Badge>
              <Badge variant="secondary" className="text-xs">严格串行流程</Badge>
            </div>
            <CardTitle className="text-xl">片区专属资料处理工作台</CardTitle>
            <CardDescription>
              按“OCR 扫描 → 向量化处理 → 图谱化处理 → 一键校验”顺序完成处理。当前为前端展示版本，后续可直接挂接后端接口。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>流程总览</span>
              <Separator orientation="vertical" className="h-4" />
              <span>1 OCR</span>
              <span>→</span>
              <span>2 向量化</span>
              <span>→</span>
              <span>3 图谱化</span>
              <span>→</span>
              <span>4 一键校验</span>
            </div>
          </CardContent>
        </Card>

        {processSections.map((section) => {
          const SectionIcon = section.icon;
          return (
            <Card key={section.id} className="min-h-[320px] border-border/80">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge className="h-6 px-2 text-xs">步骤 {section.id}</Badge>
                      <CardTitle className="text-lg">{section.title}</CardTitle>
                    </div>
                    <CardDescription>{section.subtitle}</CardDescription>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/40 p-2 text-muted-foreground">
                    <SectionIcon className="h-5 w-5" />
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                  <div className="rounded-lg border border-dashed border-border p-4">
                    <p className="text-sm font-medium">功能占位区</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      后续将在此接入 {section.title} 的参数配置、任务触发和状态回显能力。
                    </p>
                    <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                      {section.hints.map((hint) => (
                        <li key={hint}>- {hint}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <p className="text-sm font-medium">任务状态</p>
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">当前状态</span>
                        <Badge variant="outline">未开始</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">任务编号</span>
                        <span className="font-mono text-xs">TASK-{section.id.toString().padStart(2, "0")}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">最近更新时间</span>
                        <span className="text-xs">--</span>
                      </div>
                    </div>
                    <Button className="mt-4 w-full" variant={section.id === 4 ? "default" : "outline"}>
                      <PlayCircle className="mr-2 h-4 w-4" />
                      {section.id === 4 ? "生成全流程校验结果" : `启动${section.title}`}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
