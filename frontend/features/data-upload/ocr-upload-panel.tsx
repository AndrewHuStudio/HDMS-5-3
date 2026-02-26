"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  Loader2,
  AlertCircle,
  Clock,
  Files,
  BookOpen,
  Image,
  CircleCheck,
  CircleX,
  X,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useOCRStore } from "./store";
import {
  submitOCRJob,
  getOCRJobStatus,
  getOCRSummary,
} from "./api";
import type { OCRJobFile } from "./types";

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 合并行：选中的文件 + OCR 结果合为一张表
interface MergedRow {
  key: string;
  fileName: string;
  fileSize: number;
  // OCR 状态：null 表示还没提交
  ocrFile: OCRJobFile | null;
}

export function OCRUploadPanel() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const {
    currentJob,
    setCurrentJob,
    status,
    setStatus,
    error,
    setError,
    summary,
    setSummary,
    selectedDestination,
    startTime,
    setStartTime,
    reset,
  } = useOCRStore();

  useEffect(() => {
    if (startTime && (status === "uploading" || status === "processing")) {
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTime);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startTime, status]);

  const loadSummary = useCallback(async () => {
    try {
      const data = await getOCRSummary();
      setSummary(data);
    } catch (err) {
      console.error("[OCR] 加载摘要失败:", err);
    }
  }, [setSummary]);

  useEffect(() => {
    loadSummary().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddFiles = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const pdfFiles = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfFiles.length > 0) {
      setSelectedFiles((prev) => {
        const existingNames = new Set(prev.map((f) => f.name));
        const newFiles = pdfFiles.filter((f) => !existingNames.has(f.name));
        return [...prev, ...newFiles];
      });
      setError(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveRow = (fileName: string) => {
    // 从已选文件中移除
    setSelectedFiles((prev) => prev.filter((f) => f.name !== fileName));
    // 从 OCR 结果中移除
    if (currentJob) {
      const updatedFiles = currentJob.files.filter((f) => f.file_name !== fileName);
      setCurrentJob({ ...currentJob, files: updatedFiles });
    }
  };

  const pollJobStatus = useCallback(
    async (jobId: string) => {
      try {
        const job = await getOCRJobStatus(jobId);
        setCurrentJob(job);
        const allDone = job.files.every(
          (f) => f.status === "done" || f.status === "failed"
        );
        if (allDone) {
          setStatus("completed");
          await loadSummary();
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        }
      } catch (err) {
        console.error("[OCR] 轮询任务状态失败:", err);
        setError(err instanceof Error ? err.message : "轮询失败");
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    },
    [setCurrentJob, setStatus, setError, loadSummary]
  );

  const handleSubmit = async () => {
    if (selectedFiles.length === 0) {
      setError("请先选择 PDF 文件");
      return;
    }
    try {
      setStatus("uploading");
      setError(null);
      setStartTime(Date.now());
      setElapsed(0);
      const result = await submitOCRJob(selectedFiles, selectedDestination);
      if (result.rejected_count > 0) {
        setError(
          `已接受 ${result.accepted_count} 个文件，拒绝 ${result.rejected_count} 个文件`
        );
      }
      setStatus("processing");
      await pollJobStatus(result.job_id);
      pollingIntervalRef.current = setInterval(() => {
        pollJobStatus(result.job_id);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
      setStatus("error");
    }
  };

  const handleReset = () => {
    reset();
    setSelectedFiles([]);
    setElapsed(0);
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadSummary();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, []);

  // 组件重挂载时，如果任务仍在进行中，恢复轮询
  useEffect(() => {
    if (
      (status === "uploading" || status === "processing") &&
      currentJob?.job_id &&
      !pollingIntervalRef.current
    ) {
      pollJobStatus(currentJob.job_id);
      pollingIntervalRef.current = setInterval(() => {
        pollJobStatus(currentJob.job_id);
      }, 2000);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 构建合并行
  const jobFiles = currentJob?.files ?? [];
  const jobFileMap = new Map(jobFiles.map((f) => [f.file_name, f]));

  const mergedRows: MergedRow[] = selectedFiles.map((file) => ({
    key: file.name,
    fileName: file.name,
    fileSize: file.size,
    ocrFile: jobFileMap.get(file.name) ?? null,
  }));
  // 追加 OCR 结果中有但 selectedFiles 中没有的（理论上不会，但防御性处理）
  for (const jf of jobFiles) {
    if (!selectedFiles.some((f) => f.name === jf.file_name)) {
      mergedRows.push({
        key: jf.file_name,
        fileName: jf.file_name,
        fileSize: 0,
        ocrFile: jf,
      });
    }
  }

  // 无活跃任务时，用 summary.documents 填充历史 OCR 结果
  if (mergedRows.length === 0 && summary?.documents?.length) {
    for (const doc of summary.documents) {
      mergedRows.push({
        key: doc.name,
        fileName: doc.name,
        fileSize: 0,
        ocrFile: {
          id: `summary-${doc.name}`,
          file_name: doc.name,
          status: "done",
          pages: doc.pages ?? 0,
          total_pages: doc.pages ?? 0,
          progress: 100,
          markdown_path: doc.markdown_path,
        },
      });
    }
  }

  // 从 summary 构建文件名 → 图片数映射
  const summaryImageMap = new Map(
    (summary?.documents ?? []).map((d) => [d.name, d.images ?? 0])
  );

  const doneCount = mergedRows.filter((r) => r.ocrFile?.status === "done").length;
  const failedCount = mergedRows.filter((r) => r.ocrFile?.status === "failed").length;
  const totalPages = jobFiles.reduce((s, f) => s + (f.pages ?? f.total_pages ?? 0), 0);
  const isRunning = status === "uploading" || status === "processing";

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 顶部信息栏 */}
      <div className="grid grid-cols-6 gap-3">
        <StatCard
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          label="耗时"
          value={isRunning || status === "completed" ? formatDuration(elapsed) : "--"}
        />
        <StatCard
          icon={<Files className="h-4 w-4 text-muted-foreground" />}
          label="资料数"
          value={`${mergedRows.length}`}
        />
        <StatCard
          icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
          label="总页数"
          value={currentJob ? `${totalPages}` : summary ? `${summary.total_pages}` : "0"}
        />
        <StatCard
          icon={<Image className="h-4 w-4 text-muted-foreground" />}
          label="图片数"
          value={summary ? `${summary.total_images}` : "0"}
        />
        <StatCard
          icon={<CircleCheck className="h-4 w-4 text-green-500" />}
          label="成功"
          value={`${doneCount}`}
        />
        <StatCard
          icon={<CircleX className="h-4 w-4 text-red-500" />}
          label="失败"
          value={`${failedCount}`}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 两列布局：左窄操作区 + 右宽合并表格，固定行高 */}
      <div className="grid gap-4 lg:grid-cols-6 lg:grid-rows-[400px]">
        {/* 左列：操作区 */}
        <div className="lg:col-span-1 rounded-lg border border-border p-4 space-y-4">
          <p className="text-sm font-medium">OCR 操作</p>
          <Button variant="outline" onClick={handleAddFiles} disabled={isRunning} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            添加 PDF 文件
          </Button>
          <Button onClick={handleSubmit} disabled={selectedFiles.length === 0 || isRunning} className="w-full">
            {isRunning ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />处理中...</>
            ) : (
              <><Upload className="mr-2 h-4 w-4" />开始 OCR</>
            )}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={isRunning} className="w-full">
            重置
          </Button>
          <Button variant="outline" onClick={handleRefresh} disabled={isRunning || refreshing} className="w-full">
            {refreshing ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />刷新中...</>
            ) : (
              <><RefreshCw className="mr-2 h-4 w-4" />刷新数据</>
            )}
          </Button>
        </div>

        {/* 右列：合并表格 */}
        <div className="lg:col-span-5 rounded-lg border border-border p-4 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <p className="text-sm font-medium">资料列表</p>
            <Badge variant="secondary">{mergedRows.length} 个文件</Badge>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {mergedRows.length === 0 ? (
              <div className="flex items-center justify-center text-sm text-muted-foreground py-20">
                点击左侧「添加 PDF 文件」开始
              </div>
            ) : (
              <table className="w-full text-sm border-collapse min-w-[520px]">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1.5 w-10 text-center">#</th>
                    <th className="px-2 py-1.5">名称</th>
                    <th className="px-2 py-1.5 w-20 text-right">大小</th>
                    <th className="px-2 py-1.5 w-16 text-center">状态</th>
                    <th className="px-2 py-1.5 w-24 text-center">进度</th>
                    <th className="px-2 py-1.5 w-14 text-right">页数</th>
                    <th className="px-2 py-1.5 w-14 text-right">图片</th>
                    <th className="px-2 py-1.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {mergedRows.map((row, idx) => {
                    const ocr = row.ocrFile;
                    const isDone = ocr?.status === "done";
                    const isFailed = ocr?.status === "failed";
                    const isOcrProcessing =
                      ocr?.status === "processing" ||
                      ocr?.status === "uploading" ||
                      ocr?.status === "requesting" ||
                      ocr?.status === "downloading";
                    const isQueued = ocr?.status === "queued";
                    const isPending = !ocr;
                    const canRemove = !isRunning || isDone || isFailed;

                    return (
                      <tr
                        key={row.key}
                        className="group border-t border-border/50 hover:bg-muted/30"
                      >
                        <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">
                          {idx + 1}
                        </td>
                        <td className="px-2 py-1.5 max-w-0">
                          <div className="flex items-center gap-1.5">
                            {isDone && <CircleCheck className="h-3.5 w-3.5 shrink-0 text-green-500" />}
                            {isFailed && <CircleX className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                            {isOcrProcessing && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />}
                            {isQueued && <Clock className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
                            {isPending && <Files className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                            <span className="truncate" title={row.fileName}>{row.fileName}</span>
                          </div>
                          {ocr?.error && (
                            <p className="text-xs text-red-500 truncate mt-0.5" title={ocr.error}>{ocr.error}</p>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs text-muted-foreground whitespace-nowrap">
                          {row.fileSize > 0 ? formatFileSize(row.fileSize) : "--"}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <Badge
                            variant={
                              isDone ? "default" : isFailed ? "destructive" : "secondary"
                            }
                            className="text-xs"
                          >
                            {isDone
                              ? "成功"
                              : isFailed
                                ? "失败"
                                : isOcrProcessing
                                  ? "进行中"
                                  : isQueued
                                    ? "排队中"
                                    : "待开始"}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5">
                          {(isOcrProcessing || isDone) ? (
                            <div className="flex items-center gap-1.5">
                              <Progress value={ocr?.progress ?? 0} className="h-1.5 flex-1" />
                              <span className="text-xs text-muted-foreground w-8 text-right">
                                {ocr?.progress ?? 0}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground block text-center">--</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                          {isDone ? (ocr?.pages ?? "--") : "--"}
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                          {isDone ? (summaryImageMap.get(row.fileName.replace(/\.pdf$/i, "")) ?? "--") : "--"}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {canRemove && (
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(row.fileName)}
                              className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                              aria-label={`移除 ${row.fileName}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- 子组件 ---------- */

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
      {icon}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold truncate">{value}</p>
      </div>
    </div>
  );
}
