import type { AISuggestionRequest, AISuggestionResponse, ExportWordRequest } from "./types";

const APPROVAL_CHECKLIST_PORTS = [8004, 8024];
const APPROVAL_CHECKLIST_PATH_PREFIX = "/approval";
const APPROVAL_CHECKLIST_API_PROXY_PREFIX = "/api/approval";
const APPROVAL_BASE_CACHE_TTL_MS = 15_000;
const AI_SUGGESTION_TIMEOUT_BASE_MS = 45_000;
const AI_SUGGESTION_TIMEOUT_PER_ITEM_MS = 8_000;
const AI_SUGGESTION_TIMEOUT_MAX_MS = 180_000;

let cachedResolvedBase: { value: string; expiresAt: number } | null = null;

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

export async function exportChecklistWord(request: ExportWordRequest): Promise<Blob> {
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
