"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  AlertCircle,
  Clock,
  CircleCheck,
  CircleX,
  Play,
  RotateCcw,
  Database,
  Waypoints,
  GitFork,
  Files,
  Layers,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useVerificationStore } from "./verification-store";
import { useOCRStore } from "./store";
import { useVectorStore } from "./vector-store";
import { useGraphStore } from "./graph-store";
import {
  getHealthDb,
  runConsistencyCheck,
  getGraphStatistics,
  getOCRSummary,
  clearOCROutputs,
  clearIngestionData,
  clearGraphData,
} from "./api";
import type {
  CheckItem,
  VerificationReport,
  HealthDbResponse,
  ConsistencyRepairResponse,
  GraphStatistics,
  OCRSummary,
} from "./types";

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** 从多源数据聚合生成校验报告 */
export function buildReport(
  healthDb: HealthDbResponse,
  consistency: ConsistencyRepairResponse,
  graphStats: GraphStatistics | null,
  ocrSummary: OCRSummary | null,
): VerificationReport {
  const milvus = healthDb.databases.milvus ?? {};
  const mongo = healthDb.databases.mongodb ?? {};
  const neo4j = healthDb.databases.neo4j ?? {};

  const milvusVectors = milvus.error ? 0 : Number(milvus.num_entities ?? 0);
  const mongoDocuments = mongo.error ? 0 : Number(mongo.documents ?? 0);
  const mongoChunks = mongo.error ? 0 : Number(mongo.chunks ?? 0);
  const graphNodes = neo4j.error ? 0 : Number(neo4j.node_count ?? graphStats?.total_nodes ?? 0);
  const graphRels = neo4j.error ? 0 : Number(neo4j.relationship_count ?? graphStats?.total_relationships ?? 0);
  const ocrFiles = ocrSummary?.total_files ?? 0;

  const checks: CheckItem[] = [];

  // 1. 数据库连通性
  checks.push({
    id: "milvus_conn",
    label: "Milvus 连接",
    passed: !milvus.error && !!milvus.exists,
    detail: milvus.error ? `错误: ${milvus.error}` : `在线, ${milvusVectors} 条向量`,
  });
  checks.push({
    id: "mongo_conn",
    label: "MongoDB 连接",
    passed: !mongo.error,
    detail: mongo.error ? `错误: ${mongo.error}` : `在线, ${mongoDocuments} 文档 / ${mongoChunks} chunks`,
  });
  checks.push({
    id: "neo4j_conn",
    label: "Neo4j 连接",
    passed: !neo4j.error,
    detail: neo4j.error ? `错误: ${neo4j.error}` : `在线, ${graphNodes} 节点 / ${graphRels} 关系`,
  });

  // 2. 向量-Chunk 一致性
  const vectorChunkMatch = milvusVectors === mongoChunks;
  checks.push({
    id: "vector_chunk",
    label: "向量-Chunk 一致",
    passed: vectorChunkMatch,
    detail: vectorChunkMatch
      ? `${milvusVectors} == ${mongoChunks}`
      : `Milvus ${milvusVectors} / Mongo Chunks ${mongoChunks}, 差异 ${Math.abs(milvusVectors - mongoChunks)}`,
  });

  // 3. 文档一致性（chunk/vector 计数不匹配的文档）
  const inconsistentCount = consistency.inconsistent_docs.length;
  checks.push({
    id: "doc_consistency",
    label: "文档级一致性",
    passed: inconsistentCount === 0,
    detail: inconsistentCount === 0
      ? "所有文档 chunk/vector 计数一致"
      : `${inconsistentCount} 个文档存在 chunk/vector 计数不匹配`,
  });

  // 4. 图谱覆盖率
  const graphCoverage = mongoDocuments > 0 ? consistency.graph_documents / mongoDocuments : 0;
  const graphCoverageOk = mongoDocuments === 0 || graphCoverage >= 0.8;
  checks.push({
    id: "graph_coverage",
    label: "图谱文档覆盖",
    passed: graphCoverageOk,
    detail: mongoDocuments === 0
      ? "暂无入库文档"
      : `${consistency.graph_documents}/${mongoDocuments} (${(graphCoverage * 100).toFixed(0)}%)`,
  });

  // 5. OCR 产出 vs 入库对比
  if (ocrFiles > 0) {
    const ingestCoverage = mongoDocuments >= ocrFiles;
    checks.push({
      id: "ocr_ingest",
      label: "OCR-入库覆盖",
      passed: ingestCoverage,
      detail: ingestCoverage
        ? `OCR ${ocrFiles} 文档, 已入库 ${mongoDocuments}`
        : `OCR ${ocrFiles} 文档, 仅入库 ${mongoDocuments}, 缺少 ${ocrFiles - mongoDocuments}`,
    });
  }

  const failedChecks = checks.filter((c) => !c.passed);
  const overall: VerificationReport["overall"] =
    failedChecks.length === 0 ? "pass" : failedChecks.some((c) => ["milvus_conn", "mongo_conn", "vector_chunk"].includes(c.id)) ? "fail" : "warn";

  return {
    timestamp: new Date().toISOString(),
    overall,
    stats: {
      ocr_files: ocrFiles,
      mongo_documents: mongoDocuments,
      mongo_chunks: mongoChunks,
      milvus_vectors: milvusVectors,
      graph_nodes: graphNodes,
      graph_relationships: graphRels,
    },
    checks,
    inconsistent_docs: consistency.inconsistent_docs,
  };
}

export function VerificationPanel() {
  const [elapsed, setElapsed] = useState(0);
  const [showInconsistent, setShowInconsistent] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const {
    report,
    setReport,
    status,
    setStatus,
    error,
    setError,
    startTime,
    setStartTime,
    reset,
  } = useVerificationStore();

  const { summary: ocrSummary } = useOCRStore();
  const resetOcrStore = useOCRStore((state) => state.reset);
  const setOcrSummary = useOCRStore((state) => state.setSummary);
  const resetVectorStore = useVectorStore((state) => state.reset);
  const setVectorReport = useVectorStore((state) => state.setReport);
  const setVectorSysStatus = useVectorStore((state) => state.setSysStatus);
  const resetGraphStore = useGraphStore((state) => state.reset);
  const setGraphStatistics = useGraphStore((state) => state.setStatistics);

  const isRunning = status === "checking";

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

  // 组件重挂载时，如果 status 卡在 checking（await 已丢失），重置为 idle
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (status === "checking") {
        setStatus("idle");
        setStartTime(null);
        setError("校验因页面切换中断，请重新开始");
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCheck = async () => {
    try {
      setStatus("checking");
      setError(null);
      setStartTime(Date.now());
      setElapsed(0);

      // 并行调用三个接口
      const [healthDb, consistency, graphStats, ocrData] = await Promise.all([
        getHealthDb(),
        runConsistencyCheck(),
        getGraphStatistics().catch(() => null),
        getOCRSummary().catch(() => ocrSummary ?? null),
      ]);

      const result = buildReport(healthDb, consistency, graphStats, ocrData);
      setReport(result);
      setStatus("completed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "校验执行失败");
      setStatus("error");
    }
  };

  const handleReset = () => {
    void (async () => {
      const confirmed = window.confirm(
        "警告：这将删除 OCR 结果、MongoDB 和 Milvus 中的向量化数据，以及 Neo4j 中的图谱数据，且不可恢复。确认继续吗？"
      );
      if (!confirmed) return;

      await clearOCROutputs();
      await clearIngestionData(true);
      await clearGraphData();

      reset();
      resetOcrStore();
      setOcrSummary(null);
      resetVectorStore();
      setVectorReport(null);
      setVectorSysStatus(null);
      resetGraphStore();
      setGraphStatistics(null);
      setElapsed(0);
      setShowInconsistent(false);
    })().catch((err) => {
      setError(err instanceof Error ? err.message : "一键重置失败");
      setStatus("error");
    });
  };

  const passedCount = report?.checks.filter((c) => c.passed).length ?? 0;
  const failedCount = report?.checks.filter((c) => !c.passed).length ?? 0;

  return (
    <div className="space-y-4">
      {/* 顶部统计卡片 */}
      <div className="grid grid-cols-6 gap-3">
        <StatCard
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          label="耗时"
          value={isRunning || status === "completed" ? formatDuration(elapsed) : "--"}
        />
        <StatCard
          icon={<Files className="h-4 w-4 text-muted-foreground" />}
          label="入库文档"
          value={report ? `${report.stats.mongo_documents}` : "--"}
        />
        <StatCard
          icon={<Layers className="h-4 w-4 text-muted-foreground" />}
          label="Chunks"
          value={report ? `${report.stats.mongo_chunks}` : "--"}
        />
        <StatCard
          icon={<Database className="h-4 w-4 text-muted-foreground" />}
          label="向量数"
          value={report ? `${report.stats.milvus_vectors}` : "--"}
        />
        <StatCard
          icon={<Waypoints className="h-4 w-4 text-muted-foreground" />}
          label="图谱节点"
          value={report ? `${report.stats.graph_nodes}` : "--"}
        />
        <StatCard
          icon={<GitFork className="h-4 w-4 text-muted-foreground" />}
          label="图谱关系"
          value={report ? `${report.stats.graph_relationships}` : "--"}
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
        {/* 左列：操作区 + 总体状态 */}
        <div className="lg:col-span-1 rounded-lg border border-border p-4 space-y-4">
          <p className="text-sm font-medium">校验操作</p>
          <Button
            onClick={handleCheck}
            disabled={isRunning}
            className="w-full"
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                校验中...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                开始校验
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

          {/* 总体状态 */}
          {report && (
            <div className="mt-2 pt-3 border-t border-border/50 space-y-2">
              <OverallBadge overall={report.overall} />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>通过</span>
                <span className="font-medium text-green-600">{passedCount}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>异常</span>
                <span className="font-medium text-red-600">{failedCount}</span>
              </div>
            </div>
          )}
        </div>

        {/* 右列：校验结果列表 */}
        <div className="lg:col-span-5 rounded-lg border border-border p-4 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <p className="text-sm font-medium">校验结果</p>
            {report && (
              <Badge variant="secondary">{report.checks.length} 项检查</Badge>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {!report ? (
              <div className="flex items-center justify-center text-sm text-muted-foreground py-20">
                {isRunning ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在执行全流程校验，请稍候...
                  </span>
                ) : (
                  '点击左侧「开始校验」启动全流程检查'
                )}
              </div>
            ) : (
              <div className="space-y-0">
                {/* 校验项列表 */}
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-2 py-1.5 w-10 text-center">#</th>
                      <th className="px-2 py-1.5">检查项</th>
                      <th className="px-2 py-1.5 w-16 text-center">结果</th>
                      <th className="px-2 py-1.5">详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.checks.map((check, idx) => (
                      <tr
                        key={check.id}
                        className="group border-t border-border/50 hover:bg-muted/30"
                      >
                        <td className="px-2 py-2 text-center text-xs text-muted-foreground">
                          {idx + 1}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            {check.passed ? (
                              <CircleCheck className="h-3.5 w-3.5 shrink-0 text-green-500" />
                            ) : (
                              <CircleX className="h-3.5 w-3.5 shrink-0 text-red-500" />
                            )}
                            <span className="text-sm">{check.label}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <Badge
                            variant={check.passed ? "default" : "destructive"}
                            className="text-xs"
                          >
                            {check.passed ? "通过" : "异常"}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 text-xs text-muted-foreground max-w-0">
                          <span className="truncate block" title={check.detail}>
                            {check.detail}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* 不一致文档折叠区 */}
                {report.inconsistent_docs.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <button
                      onClick={() => setShowInconsistent(!showInconsistent)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showInconsistent ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <span>{report.inconsistent_docs.length} 个文档 chunk/vector 不一致</span>
                    </button>
                    {showInconsistent && (
                      <div className="mt-2 rounded border border-border/50 overflow-auto max-h-[140px]">
                        <table className="w-full text-xs border-collapse">
                          <thead className="sticky top-0 bg-muted/80">
                            <tr className="text-left text-muted-foreground">
                              <th className="px-2 py-1">doc_id</th>
                              <th className="px-2 py-1 text-right">Mongo Chunks</th>
                              <th className="px-2 py-1 text-right">Milvus Vectors</th>
                              <th className="px-2 py-1 text-right">差异</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.inconsistent_docs.map((doc) => (
                              <tr key={doc.doc_id} className="border-t border-border/30">
                                <td className="px-2 py-1 font-mono truncate max-w-[200px]" title={doc.doc_id}>
                                  {doc.doc_id}
                                </td>
                                <td className="px-2 py-1 text-right">{doc.mongo_chunks}</td>
                                <td className="px-2 py-1 text-right">{doc.milvus_vectors}</td>
                                <td className="px-2 py-1 text-right text-red-500">
                                  {Math.abs(doc.mongo_chunks - doc.milvus_vectors)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- 子组件 ---------- */

function OverallBadge({ overall }: { overall: VerificationReport["overall"] }) {
  if (overall === "pass") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2">
        <CircleCheck className="h-4 w-4 text-green-500" />
        <span className="text-sm font-medium text-green-700 dark:text-green-400">全部通过</span>
      </div>
    );
  }
  if (overall === "warn") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium text-amber-700 dark:text-amber-400">存在警告</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2">
      <CircleX className="h-4 w-4 text-red-500" />
      <span className="text-sm font-medium text-red-700 dark:text-red-400">校验失败</span>
    </div>
  );
}

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
