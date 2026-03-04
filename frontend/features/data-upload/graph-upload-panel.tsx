"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  AlertCircle,
  Clock,
  CircleCheck,
  CircleX,
  Play,
  RotateCcw,
  Network,
  Files,
  GitFork,
  Waypoints,
  Eye,
  RefreshCw,
  X,
} from "lucide-react";
import { useGraphStore } from "./graph-store";
import {
  submitBatchGraphBuild,
  getBatchGraphBuildState,
  getGraphStatistics,
  getOCRSummary,
  getIngestionReport,
  getGraphDocumentStatuses,
  getGraphVisualization,
} from "./api";
import { buildGraphProgressRows, computeGraphPanelStats, type GraphProgressRow } from "./graph-progress";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import type { SubgraphData } from "@/features/qa/types";

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function deriveOcrOutputDir(markdownPath: string): string {
  const normalized = markdownPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length >= 3) {
    return parts.slice(0, -2).join("/");
  }
  return parts.slice(0, -1).join("/");
}

function getGraphProgressValue(row: GraphProgressRow): number {
  if (row.status === "success" || row.status === "failed") return 100;
  if (row.status === "in_progress") return row.progress;
  return 0;
}

function hasActiveGraphBuildRows(rows: GraphProgressRow[]): boolean {
  return rows.some((row) => row.status === "pending" || row.status === "in_progress");
}

const CHINESE_GRAPH_ENTITY_TYPES = new Set(["片区", "地块", "空间要素", "法规", "标准", "导则"]);

export function getDisplayEntityTypes(entityTypes: string[]): string[] {
  return entityTypes.filter((type) => CHINESE_GRAPH_ENTITY_TYPES.has(type));
}

export function GraphUploadPanel() {
  const [elapsed, setElapsed] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [progressRows, setProgressRows] = useState<GraphProgressRow[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // 图谱展示（全量预览）
  const [graphLimitInput, setGraphLimitInput] = useState<string>("200");
  const [isGraphLimitFocused, setIsGraphLimitFocused] = useState(false);
  const [graphLoading, setGraphLoading] = useState<boolean>(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphSubgraph, setGraphSubgraph] = useState<SubgraphData | null>(null);

  const {
    buildResult,
    setBuildResult,
    statistics,
    setStatistics,
    status,
    setStatus,
    error,
    setError,
    startTime,
    setStartTime,
    showGraphDialog,
    setShowGraphDialog,
    reset,
  } = useGraphStore();

  const isRunning = status === "building";

  // 计时器
  useEffect(() => {
    if (startTime && isRunning) {
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
  }, [startTime, isRunning]);

  // 组件重挂载时，如果 status 卡在 building（await 已丢失），重置为 idle
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (status === "building") {
        setStatus("idle");
        setStartTime(null);
        setError("图谱构建因页面切换中断，请重新开始");
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 加载图谱统计
  const loadStatistics = useCallback(async () => {
    try {
      const data = await getGraphStatistics();
      setStatistics(data);
    } catch {
      // 静默
    }
  }, [setStatistics]);

  useEffect(() => {
    loadStatistics();
  }, [loadStatistics]);

  const loadProgressRows = useCallback(async (freshBuildResult?: typeof buildResult): Promise<GraphProgressRow[]> => {
    try {
      const ocrSummary = await getOCRSummary();
      const ocrDocs = ocrSummary.documents ?? [];
      if (ocrDocs.length === 0) {
        setProgressRows([]);
        return [];
      }

      const ocrOutputDir = deriveOcrOutputDir(ocrDocs[0].markdown_path);
      const ingestionReport = await getIngestionReport(ocrOutputDir);
      const reportDocs = ingestionReport.documents ?? [];

      // 优先使用传入的最新结果，避免 React 状态异步更新导致闭包读到旧值
      const effectiveBuildResult = freshBuildResult ?? buildResult;

      // 构建 buildMap：先从内存中的 buildResult 取，若为空则从 Neo4j 持久化状态取
      let buildMap: Map<string, { doc_id: string; file_name?: string; status: string; progress?: number | null; entities_count: number; relationships_count: number; error?: string }>;

      if ((effectiveBuildResult?.documents ?? []).length > 0) {
        buildMap = new Map(
          effectiveBuildResult!.documents.map((doc) => [
            doc.file_name ?? doc.doc_id,
            doc,
          ])
        );
      } else {
        // 内存无结果（页面刷新/切换后），从 Neo4j 查询持久化状态
        try {
          const neo4jStatus = await getGraphDocumentStatuses();
          buildMap = new Map(
            (neo4jStatus.documents ?? []).map((doc) => [
              doc.file_name || doc.doc_id,
              {
                doc_id: doc.doc_id,
                file_name: doc.file_name,
                status: doc.kg_status,
                progress: doc.progress,
                entities_count: doc.entities_count,
                relationships_count: doc.relationships_count,
                error: doc.error,
              },
            ])
          );
        } catch {
          buildMap = new Map();
        }
      }

      const rows = buildGraphProgressRows(reportDocs, Array.from(buildMap.values()));
      setProgressRows(rows);
      return rows;
    } catch {
      setProgressRows([]);
      return [];
    }
  }, [buildResult]);

  useEffect(() => {
    loadProgressRows();
  }, [loadProgressRows]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const pollBatchBuildState = useCallback(async (freshRows?: GraphProgressRow[]) => {
    const rows = freshRows ?? (await loadProgressRows());

    try {
      const state = await getBatchGraphBuildState();
      if (state.result) {
        setBuildResult(state.result);
      }

      if (state.status === "failed") {
        stopPolling();
        setError(state.error || "图谱构建失败");
        setStatus("error");
        return;
      }

      if (state.status === "completed" && !hasActiveGraphBuildRows(rows)) {
        stopPolling();
        setStatus("completed");
        await loadStatistics();
      }
    } catch {
      // 状态接口偶发失败时由下一次轮询兜底
    }
  }, [loadProgressRows, loadStatistics, setBuildResult, setError, setStatus, stopPolling]);

  // 开始构建
  const handleBuild = async () => {
    try {
      setStatus("building");
      setError(null);
      setBuildResult(null);
      setStartTime(Date.now());
      setElapsed(0);

      await loadProgressRows();
      stopPolling();
      pollingRef.current = setInterval(() => {
        void pollBatchBuildState();
      }, 2000);

      const result = await submitBatchGraphBuild(true);
      setBuildResult(result);
      const rows = await loadProgressRows(result);
      await pollBatchBuildState(rows);
    } catch (err) {
      stopPolling();
      setError(err instanceof Error ? err.message : "图谱构建失败");
      setStatus("error");
    }
  };

  const handleReset = () => {
    stopPolling();
    reset();
    setElapsed(0);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadStatistics(), loadProgressRows()]);
    } finally {
      setRefreshing(false);
    }
  };

  const parseGraphLimit = () => {
    const n = Number(graphLimitInput);
    if (!Number.isFinite(n)) return Math.min(maxAvailableNodes, 200);
    // Hard clamp to prevent accidentally freezing the UI.
    return Math.min(maxAvailableNodes, Math.max(1, Math.floor(n)));
  };
  const handleGraphLimitChange = (raw: string) => {
    const digitsOnly = raw.replace(/[^\d]/g, "");
    setGraphLimitInput(digitsOnly);
  };
  const handleGraphLimitBlur = () => {
    setGraphLimitInput(String(parseGraphLimit()));
  };

  const loadGraphVisualization = useCallback(async () => {
    setGraphLoading(true);
    setGraphError(null);
    try {
      const limit = parseGraphLimit();
      const data = await getGraphVisualization(limit, true, 8000);
      setGraphSubgraph(data);
    } catch (e) {
      setGraphSubgraph(null);
      setGraphError(e instanceof Error ? e.message : "获取图谱数据失败");
    } finally {
      setGraphLoading(false);
    }
  }, [graphLimitInput]);

  // 打开弹窗时自动加载一次
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  useEffect(() => {
    if (showGraphDialog) {
      loadGraphVisualization();
    } else {
      // 关闭弹窗时清理错误状态（保留上一次结果，避免用户误关后再开要等很久）
      setGraphError(null);
      setGraphLoading(false);
    }
  }, [showGraphDialog, loadGraphVisualization]);

  // 支持 ESC 快捷关闭图谱弹窗
  useEffect(() => {
    if (!showGraphDialog) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowGraphDialog(false);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [showGraphDialog, setShowGraphDialog]);

  const { statNodes, statRels, statDocs, statSuccess, statFailed } = computeGraphPanelStats(
    progressRows,
    statistics
  );
  const totalNodeCount = statNodes;
  const totalEdgeCount = statRels;
  const maxAvailableNodes = totalNodeCount > 0 ? totalNodeCount : 5000;
  const normalizedGraphLimitInput = String(parseGraphLimit());
  const isGraphLimitDirty = graphLimitInput !== normalizedGraphLimitInput;
  const isGraphLimitEditing = isGraphLimitFocused || isGraphLimitDirty;

  return (
    <div className="space-y-4">
      {/* 顶部信息栏：与向量化处理保持一致的整行对齐 */}
      <div className="grid grid-cols-6 gap-3">
        <StatCard
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          label="耗时"
          value={isRunning || status === "completed" ? formatDuration(elapsed) : "--"}
        />
        <StatCard
          icon={<Files className="h-4 w-4 text-muted-foreground" />}
          label="文档数"
          value={`${statDocs}`}
        />
        <StatCard
          icon={<Waypoints className="h-4 w-4 text-muted-foreground" />}
          label="总节点数"
          value={`${statNodes}`}
        />
        <StatCard
          icon={<GitFork className="h-4 w-4 text-muted-foreground" />}
          label="总关系数"
          value={`${statRels}`}
        />
        <StatCard
          icon={<CircleCheck className="h-4 w-4 text-green-500" />}
          label="成功处理"
          value={`${statSuccess}`}
        />
        <StatCard
          icon={<CircleX className="h-4 w-4 text-red-500" />}
          label="失败"
          value={`${statFailed}`}
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
          <p className="text-sm font-medium">图谱操作</p>
          <Button
            onClick={handleBuild}
            disabled={isRunning}
            className="w-full"
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                构建中...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                开始构建图谱
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowGraphDialog(true)}
            disabled={isRunning}
            className="w-full"
          >
            <Eye className="mr-2 h-4 w-4" />
            图谱展示
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

        {/* 右列：图谱构建完成度 */}
        <div className="lg:col-span-5 rounded-lg border border-border p-4 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <p className="text-sm font-medium">图谱构建完成度</p>
            <Badge variant="secondary">{progressRows.length} 个文档</Badge>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {progressRows.length === 0 ? (
              <div className="flex items-center justify-center text-sm text-muted-foreground py-20">
                {isRunning ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在构建知识图谱，请稍候...
                  </span>
                ) : (
                  "暂无可展示文档，请先完成向量化处理"
                )}
              </div>
            ) : (
              <table className="w-full text-sm border-collapse min-w-[640px]">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1.5 w-10 text-center">#</th>
                    <th className="px-2 py-1.5">文档名称</th>
                    <th className="px-2 py-1.5 w-16 text-center">状态</th>
                    <th className="px-2 py-1.5 w-28 text-center">进度</th>
                    <th className="px-2 py-1.5 w-16 text-right">实体数</th>
                    <th className="px-2 py-1.5 w-16 text-right">关系数</th>
                  </tr>
                </thead>
                <tbody>
                  {progressRows.map((doc, idx) => {
                    const isSuccess = doc.status === "success";
                    const isFailed = doc.status === "failed";
                    const isInProgress = doc.status === "in_progress";
                    const isPending = doc.status === "pending";
                    const progressValue = getGraphProgressValue(doc);
                    return (
                      <tr
                        key={doc.key}
                        className="group border-t border-border/50 hover:bg-muted/30"
                      >
                        <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">
                          {idx + 1}
                        </td>
                        <td className="px-2 py-1.5 max-w-0">
                          <div className="flex items-center gap-1.5">
                            {isSuccess && (
                              <CircleCheck className="h-3.5 w-3.5 shrink-0 text-green-500" />
                            )}
                            {isFailed && (
                              <CircleX className="h-3.5 w-3.5 shrink-0 text-red-500" />
                            )}
                            {isInProgress && (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
                            )}
                            {isPending && (
                              <Waypoints className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                            )}
                            {doc.status === "waiting_vector" && (
                              <Waypoints className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate" title={doc.fileName}>
                              {doc.fileName}
                            </span>
                          </div>
                          {doc.error && (
                            <p
                              className="text-xs text-red-500 truncate mt-0.5"
                              title={doc.error}
                            >
                              {doc.error}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <Badge
                            variant={
                              isSuccess
                                ? "default"
                                : isFailed
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="text-xs"
                          >
                            {isSuccess
                              ? "成功"
                              : isFailed
                                ? "失败"
                                : isInProgress
                                  ? "构建中"
                                  : doc.status === "vector_failed"
                                    ? "向量失败"
                                    : doc.status === "waiting_vector"
                                    ? "待向量化"
                                    : "待构建"}
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
                          {doc.entitiesCount ?? "--"}
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                          {doc.relationshipsCount ?? "--"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* 底部实体类型统计 */}
          {statistics && getDisplayEntityTypes(statistics.entity_types).length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50 shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                <Network className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">实体分布:</span>
                {getDisplayEntityTypes(statistics.entity_types).map((type) => (
                  <Badge key={type} variant="outline" className="text-xs">
                    {type} {statistics.entity_counts[type] ?? 0}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 图谱展示弹窗（占位） */}
      {showGraphDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg border border-border shadow-lg w-[calc(100vw-4rem)] h-[calc(100vh-4rem)] max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/20">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="graph-counter-board flex items-end gap-2 flex-nowrap">
                    <div className="h-12 min-w-[4rem] rounded-md border border-border/70 bg-background px-2.5 py-1">
                      <p className="text-[10px] text-muted-foreground">节点数</p>
                      <p className="mt-0.5 h-5 flex items-end text-sm font-semibold leading-none">{totalNodeCount}</p>
                    </div>
                    <div className="h-12 min-w-[4rem] rounded-md border border-border/70 bg-background px-2.5 py-1">
                      <p className="text-[10px] text-muted-foreground">关系数</p>
                      <p className="mt-0.5 h-5 flex items-end text-sm font-semibold leading-none">{totalEdgeCount}</p>
                    </div>
                    <div
                      className={`h-12 min-w-[6.9rem] rounded-md border px-2.5 py-1 transition-colors ${
                        isGraphLimitEditing
                          ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30"
                          : "border-primary/40 bg-primary/5"
                      }`}
                    >
                      <p className="text-[10px] text-muted-foreground">展示节点数</p>
                      <div className="mt-0.5 h-5 flex items-end">
                        <Input
                          value={graphLimitInput}
                          onChange={(e) => handleGraphLimitChange(e.target.value)}
                          onFocus={() => setIsGraphLimitFocused(true)}
                          onBlur={() => {
                            setIsGraphLimitFocused(false);
                            handleGraphLimitBlur();
                          }}
                          inputMode="numeric"
                          className="h-5 w-20 self-end border-0 bg-transparent p-0 text-sm font-semibold leading-none shadow-none focus-visible:ring-0"
                          aria-label="展示节点数"
                          placeholder="200"
                        />
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={loadGraphVisualization}
                      disabled={graphLoading}
                      aria-label="刷新图谱"
                    >
                      {graphLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-end justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowGraphDialog(false)}
                    className="h-8 w-8"
                    aria-label="关闭图谱弹窗"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
            {graphError && (
              <div className="px-6 py-2">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{graphError}</AlertDescription>
                </Alert>
              </div>
            )}
            <div className="flex-1 min-h-0 px-6 py-3 overflow-hidden">
              <KnowledgeGraph
                subgraph={graphSubgraph}
                isStreaming={graphLoading}
              />
            </div>
          </div>
        </div>
      )}
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
