import type { AISuggestionRequest, AISuggestionResponse, ExportWordRequest } from "./types";

const APPROVAL_CHECKLIST_PORTS = [8004, 8024];
const APPROVAL_CHECKLIST_PATH_PREFIX = "/approval";
const APPROVAL_CHECKLIST_API_PROXY_PREFIX = "/api/approval";
const APPROVAL_BASE_CACHE_TTL_MS = 5 * 60_000;
const AI_SUGGESTION_TIMEOUT_BASE_MS = 45_000;
const AI_SUGGESTION_TIMEOUT_PER_ITEM_MS = 8_000;
const AI_SUGGESTION_TIMEOUT_MAX_MS = 180_000;
const WORD_EXPORT_SYNC_TIMEOUT_MS = 90_000;
const WORD_EXPORT_JOB_CREATE_TIMEOUT_MS = 10_000;
const WORD_EXPORT_JOB_TIMEOUT_MS = 3 * 60_000;
const WORD_EXPORT_JOB_POLL_INTERVAL_MS = 1_000;

let cachedResolvedBase: { value: string; expiresAt: number } | null = null;

interface ExportWordJobCreateResponse {
  job_id: string;
  status: string;
}

interface ExportWordJobStatusResponse {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  error?: string | null;
}

class AsyncWordExportNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsyncWordExportNotSupportedError";
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function resolveEnvBase(envBase: string, origin: string) {
  if (envBase.startsWith("http://") || envBase.startsWith("https://")) {
    return trimTrailingSlash(envBase);
  }
  if (envBase.startsWith("/")) {
    return trimTrailingSlash(`${origin}${envBase}`);
  }
  return trimTrailingSlash(`${origin}/${envBase}`);
}

function getCandidateBases(): string[] {
  if (typeof window === "undefined") {
    return [`http://localhost:${APPROVAL_CHECKLIST_PORTS[0]}`];
  }

  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const origin = window.location.origin;
  const envBase = process.env.NEXT_PUBLIC_APPROVAL_CHECKLIST_BASE;

  const candidates: string[] = [];
  if (envBase) {
    candidates.push(resolveEnvBase(envBase, origin));
  }

  // 优先使用 Next 服务端代理，避免跨端口和 CORS 问题。
  candidates.push(`${origin}${APPROVAL_CHECKLIST_API_PROXY_PREFIX}`);
  // 其次尝试同域反向代理（如 nginx /approval）。
  candidates.push(`${origin}${APPROVAL_CHECKLIST_PATH_PREFIX}`);

  for (const port of APPROVAL_CHECKLIST_PORTS) {
    candidates.push(`${protocol}//${hostname}:${port}`);
  }

  const deduped = new Set<string>();
  candidates.forEach((candidate) => deduped.add(trimTrailingSlash(candidate)));
  return Array.from(deduped);
}

async function resolveApprovalChecklistBase(): Promise<string> {
  if (cachedResolvedBase && cachedResolvedBase.expiresAt > Date.now()) {
    return cachedResolvedBase.value;
  }

  const candidates = getCandidateBases();
  for (const base of candidates) {
    try {
      const response = await fetch(`${base}/health`, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        cachedResolvedBase = {
          value: base,
          expiresAt: Date.now() + APPROVAL_BASE_CACHE_TTL_MS,
        };
        return base;
      }
    } catch {
      continue;
    }
  }
  // 健康检查失败时仍返回首选基址，让调用方继续尝试并给出明确错误。
  cachedResolvedBase = {
    value: candidates[0],
    expiresAt: Date.now() + 2_000,
  };
  return candidates[0];
}

export async function generateAISuggestions(
  request: AISuggestionRequest
): Promise<AISuggestionResponse> {
  const primaryBase = await resolveApprovalChecklistBase();
  const candidates = [primaryBase, ...getCandidateBases()].filter(
    (base, index, list) => list.indexOf(base) === index
  );
  const errors: string[] = [];

  for (const apiBase of candidates) {
    try {
      const timeoutMs = Math.min(
        AI_SUGGESTION_TIMEOUT_BASE_MS + request.features.length * AI_SUGGESTION_TIMEOUT_PER_ITEM_MS,
        AI_SUGGESTION_TIMEOUT_MAX_MS
      );
      const response = await fetch(`${apiBase}/ai-suggestion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData.detail || `HTTP ${response.status}`;
        // 404 代表当前基址不匹配，继续尝试下一个候选地址。
        if (response.status === 404) {
          errors.push(`${apiBase}: ${detail}`);
          continue;
        }
        throw new Error(detail);
      }

      return (await response.json()) as AISuggestionResponse;
    } catch (error) {
      errors.push(`${apiBase}: ${error instanceof Error ? error.message : "请求失败"}`);
    }
  }

  throw new Error(`AI 建议服务不可用，请稍后重试。${errors.length ? ` (${errors[0]})` : ""}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createExportWordJob(
  request: ExportWordRequest
): Promise<{ base: string; jobId: string }> {
  const primaryBase = await resolveApprovalChecklistBase();
  const candidates = [primaryBase, ...getCandidateBases()].filter(
    (base, index, list) => list.indexOf(base) === index
  );
  const errors: string[] = [];
  let sawAsyncNotSupported = false;

  for (const apiBase of candidates) {
    try {
      const response = await fetch(`${apiBase}/export-word/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(WORD_EXPORT_JOB_CREATE_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData.detail || `HTTP ${response.status}`;
        if (response.status === 404 || response.status === 405) {
          sawAsyncNotSupported = true;
          errors.push(`${apiBase}: ${detail}`);
          continue;
        }
        throw new Error(detail);
      }

      const payload = (await response.json()) as ExportWordJobCreateResponse;
      return { base: apiBase, jobId: payload.job_id };
    } catch (error) {
      errors.push(`${apiBase}: ${error instanceof Error ? error.message : "请求失败"}`);
    }
  }

  if (sawAsyncNotSupported) {
    throw new AsyncWordExportNotSupportedError("当前服务不支持异步导出");
  }

  throw new Error(`Word 导出任务创建失败，请稍后重试。${errors.length ? ` (${errors[0]})` : ""}`);
}

async function waitForExportWordJob(base: string, jobId: string): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < WORD_EXPORT_JOB_TIMEOUT_MS) {
    const response = await fetch(`${base}/export-word/jobs/${jobId}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(WORD_EXPORT_JOB_CREATE_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const detail = errorData.detail || `HTTP ${response.status}`;
      throw new Error(detail);
    }

    const payload = (await response.json()) as ExportWordJobStatusResponse;
    if (payload.status === "completed") {
      return;
    }
    if (payload.status === "failed") {
      throw new Error(payload.error || "Word 导出任务失败");
    }

    await sleep(WORD_EXPORT_JOB_POLL_INTERVAL_MS);
  }

  throw new Error("Word 导出超时，请稍后重试");
}

async function downloadExportWordJob(base: string, jobId: string): Promise<Blob> {
  const response = await fetch(`${base}/export-word/jobs/${jobId}/download`, {
    method: "GET",
    signal: AbortSignal.timeout(WORD_EXPORT_SYNC_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const detail = errorData.detail || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return await response.blob();
}

async function exportChecklistWordSync(request: ExportWordRequest): Promise<Blob> {
  const primaryBase = await resolveApprovalChecklistBase();
  const candidates = [primaryBase, ...getCandidateBases()].filter(
    (base, index, list) => list.indexOf(base) === index
  );
  const errors: string[] = [];

  for (const apiBase of candidates) {
    try {
      const response = await fetch(`${apiBase}/export-word`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(WORD_EXPORT_SYNC_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData.detail || `HTTP ${response.status}`;
        if (response.status === 404) {
          errors.push(`${apiBase}: ${detail}`);
          continue;
        }
        throw new Error(detail);
      }

      return await response.blob();
    } catch (error) {
      errors.push(`${apiBase}: ${error instanceof Error ? error.message : "请求失败"}`);
    }
  }

  throw new Error(`Word 导出服务不可用，请稍后重试。${errors.length ? ` (${errors[0]})` : ""}`);
}

export async function exportChecklistWord(request: ExportWordRequest): Promise<Blob> {
  try {
    const job = await createExportWordJob(request);
    await waitForExportWordJob(job.base, job.jobId);
    return await downloadExportWordJob(job.base, job.jobId);
  } catch (error) {
    try {
      return await exportChecklistWordSync(request);
    } catch (syncError) {
      if (error instanceof AsyncWordExportNotSupportedError) {
        throw syncError;
      }
      const asyncMessage = error instanceof Error ? error.message : "异步导出失败";
      const syncMessage = syncError instanceof Error ? syncError.message : "同步导出失败";
      throw new Error(`异步导出失败（${asyncMessage}），同步兜底也失败（${syncMessage}）`);
    }
  }
}
