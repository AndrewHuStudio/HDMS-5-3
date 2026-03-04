// OCR & 向量化 & 图谱化 API 调用封装

import type {
  OCRJob,
  OCRSubmitResponse,
  OCRSummary,
  OCRDestinations,
  BatchIngestionResponse,
  IngestionReportResponse,
  IngestionStatus,
  BatchGraphBuildResponse,
  BatchGraphBuildStateResponse,
  GraphStatistics,
  GraphDocumentStatusResponse,
  HealthDbResponse,
  ConsistencyRepairResponse,
  // Graph visualization uses the same SubgraphData shape as QA feature.
} from "./types";
import type { SubgraphData } from "@/features/qa/types";

const normalizeBase = (value: string) => value.replace(/\/$/, "");
const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};
const isLoopbackHostname = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname === "[::1]";

const resolveDataProcessBase = () => {
  const configured = process.env.NEXT_PUBLIC_DATA_PROCESS_BASE || "";

  if (typeof window !== "undefined") {
    const onLocalHost = isLoopbackHostname(window.location.hostname);
    if (configured) {
      const configuredHost = parseUrl(configured)?.hostname || "";
      if (!onLocalHost && isLoopbackHostname(configuredHost)) {
        // 公网访问时忽略误注入的 localhost，改走同源反向代理。
        return "";
      }
      return normalizeBase(configured);
    }

    // Browser defaults to same-origin routes (/api, /ingestion, /graph) via proxy.
    return "";
  }

  if (configured) return normalizeBase(configured);

  // SSR/local fallback.
  return "http://localhost:8005";
};

// 从环境变量获取 data_process API 基础 URL（浏览器默认同源）
const DATA_PROCESS_BASE = resolveDataProcessBase();

/**
 * 提交 OCR 任务（上传文件）
 */
export async function submitOCRJob(
  files: File[],
  category: string = ""
): Promise<OCRSubmitResponse> {
  const formData = new FormData();

  files.forEach((file) => {
    formData.append("files", file);
  });

  formData.append("category", category);

  const response = await fetch(`${DATA_PROCESS_BASE}/api/jobs`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "上传失败" }));
    throw new Error(error.detail || "上传失败");
  }

  return response.json();
}

/**
 * 获取 OCR 任务状态
 */
export async function getOCRJobStatus(jobId: string): Promise<OCRJob> {
  const response = await fetch(`${DATA_PROCESS_BASE}/api/jobs/${jobId}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "获取任务状态失败" }));
    throw new Error(error.detail || "获取任务状态失败");
  }

  return response.json();
}

/**
 * 获取 OCR 结果摘要
 */
export async function getOCRSummary(): Promise<OCRSummary> {
  const response = await fetch(`${DATA_PROCESS_BASE}/api/summary`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "获取摘要失败" }));
    throw new Error(error.detail || "获取摘要失败");
  }

  return response.json();
}

/**
 * 获取输出目录列表
 */
export async function getOCRDestinations(): Promise<OCRDestinations> {
  const response = await fetch(`${DATA_PROCESS_BASE}/api/destinations`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "获取目录列表失败" }));
    throw new Error(error.detail || "获取目录列表失败");
  }

  return response.json();
}

/**
 * 清空输出目录
 */
export async function clearOCROutputs(): Promise<{ deleted: number }> {
  const response = await fetch(`${DATA_PROCESS_BASE}/api/outputs/clear`, {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "清空失败" }));
    throw new Error(error.detail || "清空失败");
  }

  return response.json();
}

// ---- 向量化处理 API ----

/**
 * 批量向量化入库（从 OCR 输出目录）
 */
export async function submitBatchIngestion(
  ocrOutputDir: string,
  category?: string,
  processImages: boolean = true
): Promise<BatchIngestionResponse> {
  const response = await fetch(`${DATA_PROCESS_BASE}/ingestion/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ocr_output_dir: ocrOutputDir,
      category: category || null,
      process_images: processImages,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "向量化提交失败" }));
    throw new Error(error.detail || "向量化提交失败");
  }

  return response.json();
}

/**
 * 获取向量化入库报告（各文档状态）
 */
export async function getIngestionReport(
  ocrOutputDir: string,
  category?: string
): Promise<IngestionReportResponse> {
  const response = await fetch(`${DATA_PROCESS_BASE}/ingestion/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ocr_output_dir: ocrOutputDir,
      category: category || null,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "获取入库报告失败" }));
    throw new Error(error.detail || "获取入库报告失败");
  }

  return response.json();
}

/**
 * 获取向量化系统状态（Milvus/MongoDB 计数）
 */
export async function getIngestionStatus(): Promise<IngestionStatus> {
  const response = await fetch(`${DATA_PROCESS_BASE}/ingestion/status`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "获取系统状态失败" }));
    throw new Error(error.detail || "获取系统状态失败");
  }

  return response.json();
}

// ---- 图谱化处理 API ----

/**
 * 批量构建知识图谱（从 MongoDB 已入库文档）
 */
export async function submitBatchGraphBuild(
  useLlm: boolean = true,
  maxDocs?: number
): Promise<BatchGraphBuildResponse> {
  const response = await fetch(`${DATA_PROCESS_BASE}/graph/build/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      use_llm: useLlm,
      max_docs: maxDocs ?? null,
      async_mode: true,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "图谱构建提交失败" }));
    throw new Error(error.detail || "图谱构建提交失败");
  }

  return response.json();
}

/**
 * 获取图谱统计信息（节点/关系数量）
 */
export async function getGraphStatistics(): Promise<GraphStatistics> {
  const response = await fetch(`${DATA_PROCESS_BASE}/graph/statistics`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "获取图谱统计失败" }));
    throw new Error(error.detail || "获取图谱统计失败");
  }

  return response.json();
}

/**
 * 获取各文档的图谱构建状态（来自 Neo4j :Document 节点）
 */
export async function getGraphDocumentStatuses(): Promise<GraphDocumentStatusResponse> {
  const response = await fetch(`${DATA_PROCESS_BASE}/graph/documents/status`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "获取文档图谱状态失败" }));
    throw new Error(error.detail || "获取文档图谱状态失败");
  }

  return response.json();
}

/**
 * 获取批量图谱构建后台任务状态（idle/running/completed/failed）
 */
export async function getBatchGraphBuildState(): Promise<BatchGraphBuildStateResponse> {
  const response = await fetch(`${DATA_PROCESS_BASE}/graph/build/batch/state`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "获取图谱构建状态失败" }));
    throw new Error(error.detail || "获取图谱构建状态失败");
  }

  return response.json();
}

/**
 * 获取“全量图谱”可视化子图（按节点度排序截断）
 */
export async function getGraphVisualization(
  limit: number = 200,
  includeDocuments: boolean = true,
  maxRelationships: number = 5000
): Promise<SubgraphData> {
  const params = new URLSearchParams({
    limit: String(limit),
    include_documents: includeDocuments ? "true" : "false",
    max_relationships: String(maxRelationships),
  });

  const response = await fetch(`${DATA_PROCESS_BASE}/graph/visualize?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "获取图谱可视化数据失败" }));
    throw new Error(error.detail || "获取图谱可视化数据失败");
  }

  return response.json();
}

// ---- 一键校验 API ----

/**
 * 获取数据库健康状态与统计
 */
export async function getHealthDb(): Promise<HealthDbResponse> {
  const response = await fetch(`${DATA_PROCESS_BASE}/health/db`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "获取数据库状态失败" }));
    throw new Error(error.detail || "获取数据库状态失败");
  }

  return response.json();
}

/**
 * 跨库一致性检查（dry_run 模式，只读不修复）
 */
export async function runConsistencyCheck(): Promise<ConsistencyRepairResponse> {
  const response = await fetch(`${DATA_PROCESS_BASE}/ingestion/repair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, cleanup_inconsistent_docs: false }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "一致性检查失败" }));
    throw new Error(error.detail || "一致性检查失败");
  }

  return response.json();
}
