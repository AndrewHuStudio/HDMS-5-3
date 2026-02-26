"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Printer,
  Save,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  exportApprovalPdf,
  fetchApprovalCheckCatalog,
  generateApprovalChecklist,
  loadApprovalDraft,
  resolveApprovalChecklistBase,
  saveApprovalDraft,
  type ApprovalChecklistCheckResult,
  type ApprovalChecklistPayload,
} from "@/lib/api/approval-checklist";
import { useModelStore } from "@/lib/stores/model-store";

type CheckSelectorItem = {
  check_id: string;
  check_name: string;
  selected: boolean;
  disabled: boolean;
  errorMessage?: string;
};

type NoticeTone = "error" | "success" | "info";
type Notice = { id: number; message: string; tone: NoticeTone };

const DEFAULT_PROJECT_ID = "demo_project_001";
const DEFAULT_PLOT_NAME = "未命名片区";
const REQUIRED_CHECK_CATALOG = [
  { check_id: "height-check", check_name: "限高检测" },
  { check_id: "setback-rate-check", check_name: "贴线率检测" },
  { check_id: "setback-check", check_name: "建筑退线检测" },
  { check_id: "green-setback-check", check_name: "绿地退线检测" },
  { check_id: "plaza-setback-check", check_name: "广场退线检测" },
  { check_id: "sky-bridge", check_name: "空中连廊检测" },
  { check_id: "sight-corridor", check_name: "视线通廊检测" },
  { check_id: "fire-ladder", check_name: "消防登高面检测" },
  { check_id: "vehicle-entrance-check", check_name: "车行出入口检测" },
  { check_id: "pedestrian-entrance-check", check_name: "人行出入口检测" },
] as const;

function buildDefaultCheckItems(): CheckSelectorItem[] {
  return REQUIRED_CHECK_CATALOG.map((item) => ({
    check_id: item.check_id,
    check_name: item.check_name,
    selected: true,
    disabled: false,
  }));
}

function formatNow() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}:${pad(
    now.getMinutes()
  )}:${pad(now.getSeconds())}`;
}

function statusLabel(status: string) {
  if (status === "pass") return "通过";
  if (status === "fail") return "不通过";
  if (status === "warning") return "待确认";
  if (status === "error") return "异常";
  return status || "未知";
}

function summarizeSelected(checks: ApprovalChecklistCheckResult[]) {
  const selected = checks.filter((item) => item.selected);
  return {
    checks_total: selected.length,
    checks_error: selected.filter((item) => item.status === "error").length,
    checks_with_failures: selected.filter((item) => item.status === "fail").length,
    items_total: selected.reduce((acc, item) => acc + (item.summary?.total || 0), 0),
    items_passed: selected.reduce((acc, item) => acc + (item.summary?.passed || 0), 0),
    items_failed: selected.reduce((acc, item) => acc + (item.summary?.failed || 0), 0),
    items_unknown: selected.reduce((acc, item) => acc + (item.summary?.unknown || 0), 0),
  };
}

function clonePayload(payload: ApprovalChecklistPayload) {
  return JSON.parse(JSON.stringify(payload)) as ApprovalChecklistPayload;
}

export function ReviewPanel() {
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const externalModelName = useModelStore((state) => state.externalModelName);

  const [projectId, setProjectId] = useState(DEFAULT_PROJECT_ID);
  const [modelPathInput, setModelPathInput] = useState("");
  const [checkItems, setCheckItems] = useState<CheckSelectorItem[]>(() => buildDefaultCheckItems());

  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const [generatedPayload, setGeneratedPayload] = useState<ApprovalChecklistPayload | null>(null);
  const [approvalBase, setApprovalBase] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [plotName, setPlotName] = useState(DEFAULT_PLOT_NAME);
  const [reviewTime, setReviewTime] = useState(formatNow());
  const [reviewComment, setReviewComment] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [notices, setNotices] = useState<Notice[]>([]);

  const pushNotice = useCallback((message: string, tone: NoticeTone = "error") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setNotices((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setNotices((prev) => prev.filter((item) => item.id !== id));
    }, 3000);
  }, []);

  useEffect(() => {
    if (modelFilePath) {
      setModelPathInput(modelFilePath);
    }
  }, [modelFilePath]);

  const loadCatalog = useCallback(async () => {
    try {
      setIsCatalogLoading(true);
      const checks = await fetchApprovalCheckCatalog();
      const checkMap = new Map(checks.map((item) => [item.check_id, item]));
      const mergedChecks = REQUIRED_CHECK_CATALOG.map((requiredItem) => {
        const serverItem = checkMap.get(requiredItem.check_id);
        return {
          check_id: requiredItem.check_id,
          check_name: serverItem?.check_name || requiredItem.check_name,
          default_selected: serverItem?.default_selected ?? true,
        };
      });
      const extras = checks.filter((item) => !REQUIRED_CHECK_CATALOG.some((required) => required.check_id === item.check_id));
      const nextCatalog = [...mergedChecks, ...extras];
      setCheckItems(
        nextCatalog.map((item) => ({
          check_id: item.check_id,
          check_name: item.check_name,
          selected: item.default_selected,
          disabled: false,
        }))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载检测项失败";
      pushNotice(`${message}，已使用默认10项检测功能`, "info");
      setCheckItems((prev) => (prev.length > 0 ? prev : buildDefaultCheckItems()));
    } finally {
      setIsCatalogLoading(false);
    }
  }, [pushNotice]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    resolveApprovalChecklistBase()
      .then((base) => setApprovalBase(base))
      .catch(() => setApprovalBase(""));
  }, []);

  const selectedCheckIds = useMemo(
    () => checkItems.filter((item) => item.selected).map((item) => item.check_id),
    [checkItems]
  );

  const checksFromPayload = useMemo(() => generatedPayload?.checks ?? [], [generatedPayload]);
  const effectivePayload = useMemo(() => {
    if (!generatedPayload) return null;
    const next = clonePayload(generatedPayload);
    next.document = {
      ...(next.document ?? {}),
      title: "城市规划管控要素审查表",
      number: docNumber,
      plot_name: plotName || DEFAULT_PLOT_NAME,
      review_time: reviewTime,
      review_comment: reviewComment,
      conclusion,
    };

    const selectedMap = new Map(checkItems.map((item) => [item.check_id, item.selected]));
    const checks = (next.checks ?? []).map((check) => ({
      ...check,
      selected: selectedMap.get(check.check_id) ?? Boolean(check.selected),
    }));
    next.checks = checks;

    const totals = summarizeSelected(checks);
    next.selected_totals = totals;
    next.document.selected_count = totals.checks_total;
    return next;
  }, [generatedPayload, docNumber, plotName, reviewTime, reviewComment, conclusion, checkItems]);

  const selectedChecksForView = useMemo(
    () => checksFromPayload.filter((check) => checkItems.find((item) => item.check_id === check.check_id)?.selected),
    [checksFromPayload, checkItems]
  );

  const viewTotals = useMemo(() => {
    if (effectivePayload?.selected_totals) return effectivePayload.selected_totals;
    return summarizeSelected(selectedChecksForView);
  }, [effectivePayload, selectedChecksForView]);

  const toggleCheck = useCallback(
    (checkId: string) => {
      setCheckItems((prev) =>
        prev.map((item) => {
          if (item.check_id !== checkId) return item;
          if (item.disabled) {
            pushNotice(item.errorMessage || `${item.check_name}检测功能异常，暂时无法显示`);
            return { ...item, selected: false };
          }
          return { ...item, selected: !item.selected };
        })
      );
    },
    [pushNotice]
  );

  const resolveNortheastImageUrl = useCallback(
    (rawPath?: string | null) => {
      if (!rawPath) return "";
      if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) return rawPath;
      if (!approvalBase) return rawPath;
      return rawPath.startsWith("/") ? `${approvalBase}${rawPath}` : `${approvalBase}/${rawPath}`;
    },
    [approvalBase]
  );

  const generateReport = useCallback(async () => {
    if (!projectId.trim()) {
      pushNotice("请先填写 project_id");
      return;
    }
    if (!modelPathInput.trim()) {
      pushNotice("请先获取 model_path（建议先运行任一检测）");
      return;
    }
    if (selectedCheckIds.length === 0) {
      pushNotice("请至少选择 1 个检测项");
      return;
    }

    try {
      setIsGenerating(true);
      const response = await generateApprovalChecklist({
        project_id: projectId.trim(),
        model_path: modelPathInput.trim(),
        selected_check_ids: selectedCheckIds,
      });
      const payload = response.payload;
      setGeneratedPayload(payload);
      setReviewTime(payload.document?.review_time || formatNow());
      setDocNumber(payload.document?.number || "");
      setPlotName(payload.document?.plot_name || DEFAULT_PLOT_NAME);
      setReviewComment(payload.document?.review_comment || "");
      setConclusion(payload.document?.conclusion || "");
      setIsDialogOpen(true);

      const payloadMap = new Map((payload.checks ?? []).map((item) => [item.check_id, item]));
      const newErrors: string[] = [];
      setCheckItems((prev) =>
        prev.map((item) => {
          const serverItem = payloadMap.get(item.check_id);
          if (!serverItem) return item;
          const isError = serverItem.status === "error";
          const nextMessage = serverItem.message || `${item.check_name}检测功能异常，暂时无法显示`;
          if (isError) {
            newErrors.push(nextMessage);
          }
          return {
            ...item,
            selected: isError ? false : Boolean(serverItem.selected),
            disabled: isError,
            errorMessage: isError ? nextMessage : undefined,
          };
        })
      );
      newErrors.forEach((message) => pushNotice(message, "error"));
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成审查表失败";
      pushNotice(message);
    } finally {
      setIsGenerating(false);
    }
  }, [projectId, modelPathInput, selectedCheckIds, pushNotice]);

  const saveDraft = useCallback(async () => {
    if (!effectivePayload) {
      pushNotice("请先生成审查表");
      return;
    }
    try {
      setIsSaving(true);
      await saveApprovalDraft({
        project_id: projectId.trim(),
        checklist_payload: effectivePayload,
        number: docNumber,
        plot_name: plotName || DEFAULT_PLOT_NAME,
        review_comment: reviewComment,
        conclusion,
      });
      pushNotice("草稿保存成功", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存草稿失败";
      pushNotice(message);
    } finally {
      setIsSaving(false);
    }
  }, [effectivePayload, projectId, docNumber, plotName, reviewComment, conclusion, pushNotice]);

  const loadDraft = useCallback(async () => {
    if (!projectId.trim()) {
      pushNotice("请先填写 project_id");
      return;
    }
    try {
      const draft = await loadApprovalDraft(projectId.trim());
      const payload = draft.checklist_payload;
      setGeneratedPayload(payload);
      setDocNumber(draft.number || payload.document?.number || "");
      setPlotName(draft.plot_name || payload.document?.plot_name || DEFAULT_PLOT_NAME);
      setReviewComment(draft.review_comment || payload.document?.review_comment || "");
      setConclusion(draft.conclusion || payload.document?.conclusion || "");
      setReviewTime(payload.document?.review_time || formatNow());
      setIsDialogOpen(true);

      const payloadMap = new Map((payload.checks ?? []).map((item) => [item.check_id, item]));
      setCheckItems((prev) =>
        prev.map((item) => {
          const serverItem = payloadMap.get(item.check_id);
          if (!serverItem) return item;
          const isError = serverItem.status === "error";
          return {
            ...item,
            selected: isError ? false : Boolean(serverItem.selected),
            disabled: isError,
            errorMessage: isError
              ? serverItem.message || `${item.check_name}检测功能异常，暂时无法显示`
              : undefined,
          };
        })
      );
      pushNotice("草稿已加载", "info");
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载草稿失败";
      pushNotice(message);
    }
  }, [projectId, pushNotice]);

  const exportPdf = useCallback(async () => {
    if (!effectivePayload) {
      pushNotice("请先生成审查表");
      return;
    }
    try {
      setIsExporting(true);
      const blob = await exportApprovalPdf({
        project_id: projectId.trim(),
        checklist_payload: effectivePayload,
        file_name: `approval-checklist-${projectId || "export"}.pdf`,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `approval-checklist-${projectId || "export"}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      pushNotice("PDF 导出成功", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "导出 PDF 失败";
      pushNotice(message);
    } finally {
      setIsExporting(false);
    }
  }, [effectivePayload, projectId, pushNotice]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  return (
    <>
      <Card className="h-full flex flex-col gap-0 bg-transparent border-0 rounded-none py-0 shadow-none">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-primary" />
              <span>管控审批清单</span>
            </CardTitle>
            <Button size="sm" onClick={generateReport} disabled={isGenerating || isCatalogLoading}>
              {isGenerating ? "生成中..." : "生成审查表"}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-2 mt-4">
            <Input
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              placeholder="project_id"
            />
            <Input
              value={modelPathInput}
              onChange={(event) => setModelPathInput(event.target.value)}
              placeholder="model_path（如 xxxxxxxx.3dm）"
            />
            <div className="text-xs text-muted-foreground">
              当前模型：{externalModelName || "未加载"}；model_path：{modelFilePath || "未获取"}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={loadDraft}>
                读取草稿
              </Button>
              <Button variant="outline" size="sm" onClick={saveDraft} disabled={isSaving || !effectivePayload}>
                {isSaving ? "保存中..." : "保存草稿"}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 p-0 min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-lg font-semibold">{selectedCheckIds.length}</div>
                  <div className="text-xs text-muted-foreground">已选检测项</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-lg font-semibold">{viewTotals.items_passed || 0}</div>
                  <div className="text-xs text-muted-foreground">通过条目</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-lg font-semibold text-red-600">{viewTotals.items_failed || 0}</div>
                  <div className="text-xs text-muted-foreground">不通过条目</div>
                </div>
              </div>

              {!generatedPayload ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  请选择检测项并点击“生成审查表”。
                </div>
              ) : (
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="font-medium">最新生成结果</div>
                  <div className="text-sm text-muted-foreground">
                    标题：{effectivePayload?.document?.title || "城市规划管控要素审查表"}
                  </div>
                  <div className="text-sm text-muted-foreground">审查时间：{reviewTime}</div>
                  <div className="text-sm text-muted-foreground">要素数量：{viewTotals.checks_total || 0}</div>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>

        <div className="border-t border-border p-3 space-y-2">
          <div className="text-sm font-medium">审查检测功能（默认全选）</div>
          <div className="max-h-48 overflow-auto space-y-2 pr-1">
            {checkItems.map((item) => (
              <label
                key={item.check_id}
                className="flex items-center justify-between gap-3 rounded border px-2 py-1.5 text-sm cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Checkbox checked={item.selected} onCheckedChange={() => toggleCheck(item.check_id)} />
                  <span className="truncate">{item.check_name}</span>
                </div>
                {item.disabled && <span className="text-xs text-red-600">异常</span>}
              </label>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            异常项点击后会提示“xxx检测功能异常，暂时无法显示”，并自动取消勾选。
          </div>
        </div>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="w-[92vw] max-w-5xl">
          <DialogHeader>
            <DialogTitle>城市规划管控要素审查表</DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[65vh] pr-2">
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">编号</div>
                  <Input value={docNumber} onChange={(event) => setDocNumber(event.target.value)} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">片区名称</div>
                  <Input value={plotName} onChange={(event) => setPlotName(event.target.value)} />
                </div>
                <div className="col-span-2 text-sm text-muted-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  审查检测时间：{reviewTime}
                </div>
                <div className="col-span-2 text-sm text-muted-foreground flex items-center gap-2">
                  <Clock3 className="h-4 w-4" />
                  要素数量：{viewTotals.checks_total || 0}
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="font-semibold">管控要素审查明细</div>
                {selectedChecksForView.map((check) => (
                  <div key={check.check_id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{check.check_name}</div>
                      <div className="text-xs rounded px-2 py-0.5 border">{statusLabel(check.status)}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      通过 {check.summary?.passed || 0} 项，不通过 {check.summary?.failed || 0} 项，待确认{" "}
                      {check.summary?.unknown || 0} 项
                    </div>

                    <div className="space-y-1">
                      <div className="text-sm font-medium">不通过项</div>
                      {(check.failed_items ?? []).length === 0 ? (
                        <div className="text-sm text-muted-foreground">无</div>
                      ) : (
                        (check.failed_items ?? []).slice(0, 8).map((item) => (
                          <div key={item.item_id} className="text-sm">
                            - {item.title}
                            {item.reasons?.length ? (
                              <span className="text-muted-foreground">（{item.reasons.join("，")}）</span>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>

                    <div className="rounded border border-dashed p-3 text-xs text-muted-foreground space-y-2">
                      <div>
                        检测结果东北视角图：
                        {check.northeast_view?.message || "待接入"}
                      </div>
                      {resolveNortheastImageUrl(check.northeast_view?.image_path) ? (
                        <img
                          src={resolveNortheastImageUrl(check.northeast_view?.image_path)}
                          alt={`${check.check_name}-东北视角图`}
                          className="w-full max-h-48 object-contain rounded border bg-white"
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="font-semibold">审查意见</div>
                <Textarea
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                  placeholder="请输入审查意见..."
                  className="min-h-[110px]"
                />
              </div>

              <div className="space-y-2">
                <div className="font-semibold">审查结论</div>
                <div className="flex items-center gap-5 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={conclusion === "同意通过"}
                      onChange={() => setConclusion("同意通过")}
                    />
                    同意通过
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={conclusion === "需要整改"}
                      onChange={() => setConclusion("需要整改")}
                    />
                    需要整改
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={conclusion === "不予通过"}
                      onChange={() => setConclusion("不予通过")}
                    />
                    不予通过
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded border p-3 space-y-2">
                  <div className="font-medium text-sm">审查人签字</div>
                  <div className="h-12 border-b" />
                  <div className="text-xs text-muted-foreground">日期：{reviewTime}</div>
                </div>
                <div className="rounded border p-3 space-y-2">
                  <div className="font-medium text-sm">部门盖章</div>
                  <div className="h-16 border border-dashed rounded flex items-center justify-center text-xs text-muted-foreground">
                    盖章区
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>

          <div className="flex items-center justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" />
              打印
            </Button>
            <Button variant="outline" onClick={saveDraft} disabled={isSaving || !effectivePayload}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? "保存中..." : "保存草稿"}
            </Button>
            <Button onClick={exportPdf} disabled={isExporting || !effectivePayload}>
              <Download className="h-4 w-4 mr-2" />
              {isExporting ? "导出中..." : "导出PDF"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {notices.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[120] space-y-2">
          {notices.map((notice) => (
            <div
              key={notice.id}
              className={`max-w-sm rounded-lg border px-3 py-2 shadow-lg text-sm bg-card ${
                notice.tone === "error"
                  ? "border-red-300"
                  : notice.tone === "success"
                    ? "border-emerald-300"
                    : "border-blue-300"
              }`}
            >
              <div className="flex items-start gap-2">
                {notice.tone === "error" ? (
                  <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
                )}
                <span>{notice.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
