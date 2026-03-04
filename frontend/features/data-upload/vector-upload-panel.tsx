"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Database,
  Loader2,
  AlertCircle,
  Clock,
  Files,
  Layers,
  CircleCheck,
  CircleX,
  Play,
  RotateCcw,
  RefreshCw,
} from "lucide-react";
import { useVectorStore } from "./vector-store";
import { useOCRStore } from "./store";
import {
  submitBatchIngestion,
  getIngestionReport,
  getIngestionStatus,
  getOCRSummary,
} from "./api";
import type { IngestionDocState } from "./types";

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// 从 markdown_path 推导 ocr_output_dir（向上 2 级: ocr_output/<doc>/file.md）
function deriveOcrOutputDir(markdownPath: string): string {
  // 统一分隔符
  const normalized = markdownPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  // 去掉最后 2 段: <doc_name>/file.md
  if (parts.length >= 3) {
    return parts.slice(0, -2).join("/");
  }
  return parts.slice(0, -1).join("/");
}

// 合并行：OCR 文档 + 入库状态
interface MergedVectorRow {
  key: string;
  fileName: string;
  markdownPath: string;
  pages: number;
  images: number;
  // 入库状态
  ingestion: IngestionDocState | null;
}

function getVectorProgressValue(ingestion: IngestionDocState | null): number {
  if (!ingestion || ingestion.status === "not_started") return 0;
  if (ingestion.status === "in_progress") return 60;
  return 100;
}

export function VectorUploadPanel() {
  const [elapsed, setElapsed] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [ocrDocs, setOcrDocs] = useState<
    Array<{ name: string; category: string; markdown_path: string; pages: number; images: number }>
  >([]);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const {
    selectedDocs,
    toggleDoc,
    selectAll,
    clearSelection,
    report,
    setReport,
    sysStatus,
    setSysStatus,
    status,
    setStatus,
    error,
    setError,
    startTime,
    setStartTime,
    reset,
  } = useVectorStore();

  const { summary: ocrSummary } = useOCRStore();

  // 计时器
  useEffect(() => {
    if (startTime && status === "ingesting") {
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

  // 加载 OCR 已完成文档列表
  const loadOcrDocs = useCallback(async () => {
    try {
      const data = ocrSummary ?? (await getOCRSummary());
      setOcrDocs(data.documents ?? []);
    } catch {
      // OCR 服务不可用时静默
    }
  }, [ocrSummary]);

  useEffect(() => {
    loadOcrDocs();
  }, [loadOcrDocs]);

  // 加载系统状态
  const loadSysStatus = useCallback(async () => {
    try {
      const data = await getIngestionStatus();
      setSysStatus(data);
    } catch {
      // 静默
    }
  }, [setSysStatus]);

  useEffect(() => {
    loadSysStatus();
  }, [loadSysStatus]);

  // 加载入库报告
  const loadReport = useCallback(
    async (ocrOutputDir: string) => {
      try {
        const data = await getIngestionReport(ocrOutputDir);
        setReport(data);
        setError(null);
        const allDone =
          data.total > 0 &&
          data.in_progress === 0 &&
          data.not_started === 0 &&
          data.complete + data.failed === data.total;
        if (allDone) {
          setStatus("completed");
        }
        return data;
      } catch {
        return null;
      }
    },
    [setError, setReport, setStatus]
  );

  // 初始加载报告（如果有 OCR 文档）
  useEffect(() => {
    if (ocrDocs.length > 0) {
      const dir = deriveOcrOutputDir(ocrDocs[0].markdown_path);
      loadReport(dir);
    }
  }, [ocrDocs, loadReport]);

  const handleSelectAll = () => {
    selectAll(ocrDocs.map((d) => d.markdown_path));
  };

  const handleSubmit = async () => {
    if (ocrDocs.length === 0) {
      setError("没有可用的 OCR 文档");
      return;
    }

    const dir = deriveOcrOutputDir(ocrDocs[0].markdown_path);

    try {
      setStatus("ingesting");
      setError(null);
      setStartTime(Date.now());
      setElapsed(0);

      await submitBatchIngestion(dir);

      // 开始轮询报告
      pollingRef.current = setInterval(async () => {
        const rpt = await loadReport(dir);
        if (rpt) {
          const allDone = rpt.documents.every(
            (d) => d.status === "complete" || d.status === "failed"
          );
          if (allDone && rpt.in_progress === 0) {
            setStatus("completed");
            await loadSysStatus();
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          }
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "向量化提交失败");
      setStatus("error");
    }
  };

  const handleReset = () => {
    reset();
    setElapsed(0);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadOcrDocs();
      await loadSysStatus();
      if (ocrDocs.length > 0) {
        const dir = deriveOcrOutputDir(ocrDocs[0].markdown_path);
        await loadReport(dir);
      }
      setError(null);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // ocrDocs 加载完后，自动查一次 report（显示已入库状态）
  // 如果任务仍在进行中，额外恢复轮询
  useEffect(() => {
    if (ocrDocs.length === 0) return;
    const dir = deriveOcrOutputDir(ocrDocs[0].markdown_path);
    loadReport(dir);

    if (status === "ingesting" && !pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        const rpt = await loadReport(dir);
        if (rpt) {
          const allDone = rpt.documents.every(
            (d) => d.status === "complete" || d.status === "failed"
          );
          if (allDone && rpt.in_progress === 0) {
            setStatus("completed");
            await loadSysStatus();
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          }
        }
      }, 3000);
    }
  }, [ocrDocs]); // eslint-disable-line react-hooks/exhaustive-deps

  // 构建合并行
  const reportMap = new Map(
    (report?.documents ?? []).map((d) => [d.file_name, d])
  );

  const mergedRows: MergedVectorRow[] = ocrDocs.map((doc) => ({
    key: doc.markdown_path,
    fileName: doc.name,
    markdownPath: doc.markdown_path,
    pages: doc.pages,
    images: doc.images ?? 0,
    ingestion: reportMap.get(doc.name) ?? null,
  }));

  const completeCount = mergedRows.filter(
    (r) => r.ingestion?.status === "complete"
  ).length;
  const failedCount = mergedRows.filter(
    (r) => r.ingestion?.status === "failed"
  ).length;
  const totalChunks = mergedRows.reduce(
    (s, r) => s + (r.ingestion?.chunks_count ?? 0),
    0
  );
  const isRunning = status === "ingesting" || status === "loading";

  return (
    <div className="space-y-4">
      {/* 顶部信息栏 */}
      <div className="grid grid-cols-6 gap-3">
        <StatCard
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          label="耗时"
          value={
            isRunning || status === "completed"
              ? formatDuration(elapsed)
              : "--"
          }
        />
        <StatCard
          icon={<Files className="h-4 w-4 text-muted-foreground" />}
          label="文档数"
          value={`${mergedRows.length}`}
        />
        <StatCard
          icon={<Layers className="h-4 w-4 text-muted-foreground" />}
          label="总 Chunks"
          value={`${totalChunks}`}
        />
        <StatCard
          icon={<Database className="h-4 w-4 text-muted-foreground" />}
          label="向量数"
          value={sysStatus ? `${sysStatus.milvus_vectors}` : "--"}
        />
        <StatCard
          icon={<CircleCheck className="h-4 w-4 text-green-500" />}
          label="成功"
          value={`${completeCount}`}
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

      {/* 两列布局 */}
      <div className="grid gap-4 lg:grid-cols-6 lg:grid-rows-[400px]">
        {/* 左列：操作区 */}
        <div className="lg:col-span-1 rounded-lg border border-border p-4 space-y-4">
          <p className="text-sm font-medium">向量化操作</p>
          <Button
            variant="outline"
            onClick={handleSelectAll}
            disabled={isRunning || ocrDocs.length === 0}
            className="w-full"
          >
            <Files className="mr-2 h-4 w-4" />
            全选 OCR 资料
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={ocrDocs.length === 0 || isRunning}
            className="w-full"
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                开始向量化
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={isRunning}
            className="w-full"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            重置
          </Button>
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={isRunning || refreshing}
            className="w-full"
          >
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
            <p className="text-sm font-medium">文档列表</p>
            <Badge variant="secondary">{mergedRows.length} 个文档</Badge>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {mergedRows.length === 0 ? (
              <div className="flex items-center justify-center text-sm text-muted-foreground py-20">
                请先完成 OCR 扫描
              </div>
            ) : (
              <table className="w-full text-sm border-collapse min-w-[640px]">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1.5 w-10 text-center">#</th>
                    <th className="px-2 py-1.5">名称</th>
                    <th className="px-2 py-1.5 w-14 text-right">页数</th>
                    <th className="px-2 py-1.5 w-14 text-right">图片</th>
                    <th className="px-2 py-1.5 w-16 text-center">状态</th>
                    <th className="px-2 py-1.5 w-28 text-center">进度</th>
                    <th className="px-2 py-1.5 w-16 text-right">Chunks</th>
                  </tr>
                </thead>
                <tbody>
                  {mergedRows.map((row, idx) => {
                    const ing = row.ingestion;
                    const isComplete = ing?.status === "complete";
                    const isFailed = ing?.status === "failed";
                    const isInProgress = ing?.status === "in_progress";
                    const isNotStarted = !ing || ing.status === "not_started";
                    const progressValue = getVectorProgressValue(ing);

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
                            {isComplete && (
                              <CircleCheck className="h-3.5 w-3.5 shrink-0 text-green-500" />
                            )}
                            {isFailed && (
                              <CircleX className="h-3.5 w-3.5 shrink-0 text-red-500" />
                            )}
                            {isInProgress && (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
                            )}
                            {isNotStarted && (
                              <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate" title={row.fileName}>
                              {row.fileName}
                            </span>
                          </div>
                          {ing?.ingest_error && (
                            <p
                              className="text-xs text-red-500 truncate mt-0.5"
                              title={ing.ingest_error}
                            >
                              {ing.ingest_error}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                          {row.pages}
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                          {row.images}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <Badge
                            variant={
                              isComplete
                                ? "default"
                                : isFailed
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="text-xs"
                          >
                            {isComplete
                              ? "成功"
                              : isFailed
                                ? "失败"
                                : isInProgress
                                  ? "进行中"
                                  : "待开始"}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <Progress value={progressValue} className="h-1.5 flex-1" />
                            <span className="text-xs text-muted-foreground w-8 text-right">
                              {progressValue}%
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                          {ing?.chunks_count ?? "--"}
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
