"use client";

import React from "react"

import { DialogTitle } from "@/components/ui/dialog"

import { DialogHeader } from "@/components/ui/dialog"

import { DialogContent } from "@/components/ui/dialog"

import { DialogTrigger } from "@/components/ui/dialog"

import { Dialog } from "@/components/ui/dialog"

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  mockLandPlot,
  elementTypeNames,
  statusConfig,
  type CityElement,
  type ControlStatus,
} from "@/lib/city-data";
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Stamp,
  PenLine,
  Download,
  Printer,
  Building2,
  Calendar,
  FileCheck,
  X,
  GripHorizontal,
} from "lucide-react";

interface ReviewItem {
  elementId: string;
  elementName: string;
  elementType: string;
  controlId: string;
  controlName: string;
  currentValue: string | number;
  limitValue: string | number;
  unit: string;
  status: ControlStatus;
  suggestion?: string;
  checked: boolean;
}

function generateReviewItems(): ReviewItem[] {
  const items: ReviewItem[] = [];
  mockLandPlot.elements.forEach((element) => {
    element.controls.forEach((control) => {
      items.push({
        elementId: element.id,
        elementName: element.name,
        elementType: elementTypeNames[element.type],
        controlId: control.id,
        controlName: control.name,
        currentValue: control.currentValue,
        limitValue: control.limitValue,
        unit: control.unit,
        status: control.status,
        suggestion: control.suggestion,
        checked: control.status === "safe",
      });
    });
  });
  return items;
}

function StatusIcon({ status }: { status: ControlStatus }) {
  if (status === "safe") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  }
  if (status === "in-progress") {
    return <Clock className="h-4 w-4 text-amber-500" />;
  }
  return <AlertTriangle className="h-4 w-4 text-red-500" />;
}

export function ReviewPanel() {
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>(generateReviewItems);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewDate] = useState(new Date().toLocaleDateString("zh-CN"));
  const [comments, setComments] = useState("");
  
  // 拖动相关状态
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 居中弹窗
  useEffect(() => {
    if (isDialogOpen && dialogRef.current) {
      const rect = dialogRef.current.getBoundingClientRect();
      setPosition({
        x: (window.innerWidth - rect.width) / 2,
        y: Math.max(20, (window.innerHeight - rect.height) / 2),
      });
    }
  }, [isDialogOpen]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.drag-handle')) {
      setIsDragging(true);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialX: position.x,
        initialY: position.y,
      };
      e.preventDefault();
    }
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging && dragRef.current) {
      const deltaX = e.clientX - dragRef.current.startX;
      const deltaY = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.initialX + deltaX,
        y: dragRef.current.initialY + deltaY,
      });
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragRef.current = null;
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const totalItems = reviewItems.length;
  const checkedItems = reviewItems.filter((item) => item.checked).length;
  const safeItems = reviewItems.filter((item) => item.status === "safe").length;
  const warningItems = reviewItems.filter((item) => item.status === "in-progress").length;
  const exceededItems = reviewItems.filter((item) => item.status === "exceeded").length;

  const allChecked = checkedItems === totalItems;
  const canApprove = exceededItems === 0;

  const toggleCheck = (controlId: string) => {
    setReviewItems((prev) =>
      prev.map((item) =>
        item.controlId === controlId ? { ...item, checked: !item.checked } : item
      )
    );
  };

  const checkAll = () => {
    setReviewItems((prev) => prev.map((item) => ({ ...item, checked: true })));
  };

  // 按要素分组
  const groupedItems = reviewItems.reduce(
    (acc, item) => {
      if (!acc[item.elementId]) {
        acc[item.elementId] = {
          elementName: item.elementName,
          elementType: item.elementType,
          items: [],
        };
      }
      acc[item.elementId].items.push(item);
      return acc;
    },
    {} as Record<string, { elementName: string; elementType: string; items: ReviewItem[] }>
  );

  return (
    <Card className="h-full flex flex-col gap-0 bg-transparent border-0 rounded-none py-0 shadow-none">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-primary" />
            <span>政府审核表</span>
          </CardTitle>
          <Button size="sm" className="gap-2" onClick={() => setIsDialogOpen(true)}>
            <FileCheck className="h-4 w-4" />
            生成审查表
          </Button>
        </div>

        {/* 统计概览 */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          <div className="p-2 bg-muted/40 border border-border rounded-lg text-center">
            <p className="text-xl font-bold text-foreground">{totalItems}</p>
            <p className="text-xs text-muted-foreground">总计</p>
          </div>
          <div className="p-2 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 rounded-lg text-center">
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-300">{safeItems}</p>
            <p className="text-xs text-muted-foreground">符合</p>
          </div>
          <div className="p-2 bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 rounded-lg text-center">
            <p className="text-xl font-bold text-amber-600 dark:text-amber-300">{warningItems}</p>
            <p className="text-xs text-muted-foreground">进展中</p>
          </div>
          <div className="p-2 bg-red-50 border border-red-200 dark:bg-red-950/40 dark:border-red-800 rounded-lg text-center">
            <p className="text-xl font-bold text-red-600 dark:text-red-300">{exceededItems}</p>
            <p className="text-xs text-muted-foreground">超标</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4">
            {/* 片区信息 */}
            <div className="p-4 bg-muted/40 border border-border rounded-lg">
              <h3 className="font-semibold text-foreground mb-2">{mockLandPlot.name}</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">总面积: </span>
                  <span className="font-medium">
                    {mockLandPlot.totalArea.toLocaleString()} ㎡
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">状态: </span>
                  <Badge
                    variant={
                      mockLandPlot.approvalStatus === "approved"
                        ? "default"
                        : mockLandPlot.approvalStatus === "rejected"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {mockLandPlot.approvalStatus === "pending"
                      ? "待审核"
                      : mockLandPlot.approvalStatus === "approved"
                        ? "已通过"
                        : "已驳回"}
                  </Badge>
                </div>
              </div>
            </div>

            {/* 审核进度 */}
            <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-100 dark:bg-blue-950/40 dark:border-blue-900 rounded-lg">
              <span className="text-sm text-foreground">
                已核查: {checkedItems}/{totalItems} 项
              </span>
              <Button variant="outline" size="sm" onClick={checkAll}>
                全部勾选
              </Button>
            </div>

            <Separator />

            {/* 分组审核项 */}
            {Object.entries(groupedItems).map(([elementId, group]) => (
              <div key={elementId} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <h4 className="font-medium text-sm">{group.elementName}</h4>
                  <Badge variant="outline" className="text-xs">
                    {group.elementType}
                  </Badge>
                </div>

                <div className="space-y-2 pl-6">
                  {group.items.map((item) => (
                    <div
                      key={item.controlId}
                      className={`p-3 rounded-lg border transition-colors ${
                        item.checked ? "bg-emerald-500/5 border-emerald-500/20" : "bg-secondary/30 border-border"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={item.checked}
                          onCheckedChange={() => toggleCheck(item.controlId)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm">{item.controlName}</span>
                            <StatusIcon status={item.status} />
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                            <span>
                              当前: {item.currentValue}
                              {item.unit}
                            </span>
                            <span>
                              限制: {item.limitValue}
                              {item.unit}
                            </span>
                          </div>
                          {item.suggestion && (
                            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-200 dark:bg-amber-950/40 dark:border-amber-800 p-2 rounded">
                              {item.suggestion}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>

      {/* 可拖动的审查表弹窗 */}
      {isDialogOpen && (
        <>
          {/* 遮罩层 */}
          <div 
            className="fixed inset-0 bg-black/50 z-[100]"
            onClick={() => setIsDialogOpen(false)}
          />
          
          {/* 可拖动弹窗 */}
          <div
            ref={dialogRef}
            className="fixed z-[101] bg-card border border-border rounded-lg shadow-2xl flex flex-col"
            style={{
              left: position.x,
              top: position.y,
              width: '900px',
              maxWidth: '90vw',
              maxHeight: '85vh',
              cursor: isDragging ? 'grabbing' : 'auto',
            }}
            onMouseDown={handleMouseDown}
          >
            {/* 可拖动标题栏 */}
            <div className="drag-handle flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40 rounded-t-lg cursor-grab active:cursor-grabbing">
              <div className="flex items-center gap-2">
                <GripHorizontal className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold">城市规划管控审查表</h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setIsDialogOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            {/* 弹窗内容 */}
            <div className="flex-1 overflow-hidden">
              <ReviewDocument
                plot={mockLandPlot}
                groupedItems={groupedItems}
                reviewerName={reviewerName}
                reviewDate={reviewDate}
                comments={comments}
                setReviewerName={setReviewerName}
                setComments={setComments}
                allChecked={allChecked}
                canApprove={canApprove}
              />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// 审查文档组件
function ReviewDocument({
  plot,
  groupedItems,
  reviewerName,
  reviewDate,
  comments,
  setReviewerName,
  setComments,
  allChecked,
  canApprove,
}: {
  plot: typeof mockLandPlot;
  groupedItems: Record<string, { elementName: string; elementType: string; items: ReviewItem[] }>;
  reviewerName: string;
  reviewDate: string;
  comments: string;
  setReviewerName: (name: string) => void;
  setComments: (comments: string) => void;
  allChecked: boolean;
  canApprove: boolean;
}) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-6 bg-card text-foreground rounded-lg">
        {/* 文档标题 */}
        <div className="text-center border-b-2 border-border pb-4">
          <h1 className="text-2xl font-bold">城市规划管控要素审查表</h1>
          <p className="text-sm text-muted-foreground mt-2">
            编号: REV-{plot.id}-{Date.now().toString().slice(-6)}
          </p>
        </div>

        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-4 p-4 border border-border rounded">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              <strong>片区名称:</strong> {plot.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              <strong>审查日期:</strong> {reviewDate}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">
              <strong>总面积:</strong> {plot.totalArea.toLocaleString()} ㎡
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">
              <strong>要素数量:</strong> {plot.elements.length} 项
            </span>
          </div>
        </div>

        {/* 审查内容 */}
        <div>
          <h2 className="text-lg font-bold mb-4 border-b border-border pb-2">
            管控要素审查明细
          </h2>

          {Object.entries(groupedItems).map(([elementId, group]) => (
            <div key={elementId} className="mb-6">
              <h3 className="font-semibold bg-muted/60 p-2 rounded mb-2">
                {group.elementName} ({group.elementType})
              </h3>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/40">
                    <th className="border border-border p-2 text-left">指标名称</th>
                    <th className="border border-border p-2 text-center">当前值</th>
                    <th className="border border-border p-2 text-center">限制值</th>
                    <th className="border border-border p-2 text-center">状态</th>
                    <th className="border border-border p-2 text-center w-16">核查</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => (
                    <tr key={item.controlId}>
                      <td className="border border-border p-2">{item.controlName}</td>
                      <td className="border border-border p-2 text-center font-mono">
                        {item.currentValue}
                        {item.unit}
                      </td>
                      <td className="border border-border p-2 text-center font-mono">
                        {item.limitValue}
                        {item.unit}
                      </td>
                      <td className="border border-border p-2 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                            item.status === "safe"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                              : item.status === "in-progress"
                                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
                                : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                          }`}
                        >
                          {statusConfig[item.status].label}
                        </span>
                      </td>
                      <td className="border border-border p-2 text-center">
                        {item.checked ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600 mx-auto" />
                        ) : (
                          <div className="w-5 h-5 border-2 border-border rounded mx-auto" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {group.items.some((item) => item.suggestion) && (
                <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 dark:bg-yellow-950/40 dark:border-yellow-800 rounded text-sm">
                  <strong>优化建议:</strong>
                  <ul className="list-disc list-inside mt-1">
                    {group.items
                      .filter((item) => item.suggestion)
                      .map((item) => (
                        <li key={item.controlId}>
                          {item.controlName}: {item.suggestion}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 审查意见 */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold border-b border-border pb-2">审查意见</h2>
          <Textarea
            placeholder="请输入审查意见..."
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="min-h-[100px] bg-background text-foreground border-border"
          />
        </div>

        {/* 审查结论 */}
        <div className="p-4 border-2 border-border rounded">
          <h2 className="text-lg font-bold mb-4">审查结论</h2>
          <div className="flex items-center gap-8">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="conclusion"
                checked={canApprove && allChecked}
                readOnly
                className="w-4 h-4"
              />
              <span>同意通过</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="conclusion"
                checked={!canApprove}
                readOnly
                className="w-4 h-4"
              />
              <span>需要整改</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="conclusion" className="w-4 h-4" />
              <span>不予通过</span>
            </label>
          </div>
        </div>

        {/* 签字盖章区 */}
        <div className="grid grid-cols-2 gap-8 pt-4">
          <div className="space-y-4">
            <h3 className="font-bold flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              审核人签字
            </h3>
            <div className="border-b-2 border-border pb-2">
              <input
                type="text"
                placeholder="签字:"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                className="w-full bg-transparent outline-none text-lg"
              />
            </div>
            <p className="text-sm text-muted-foreground">日期: {reviewDate}</p>
          </div>
          <div className="space-y-4">
            <h3 className="font-bold flex items-center gap-2">
              <Stamp className="h-4 w-4" />
              部门盖章
            </h3>
            <div className="h-24 border-2 border-dashed border-border rounded flex items-center justify-center">
              <span className="text-muted-foreground">盖章处</span>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-4 pt-4 border-t border-border">
          <Button variant="outline" className="gap-2 bg-transparent">
            <Printer className="h-4 w-4" />
            打印
          </Button>
          <Button variant="outline" className="gap-2 bg-transparent">
            <Download className="h-4 w-4" />
            导出PDF
          </Button>
          <Button
            className="gap-2"
            disabled={!canApprove || !allChecked || !reviewerName}
          >
            <FileCheck className="h-4 w-4" />
            提交审批
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}
