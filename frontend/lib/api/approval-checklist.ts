import { normalizeApiBase, resolveApiBase } from "@/lib/api-base";

export interface ApprovalCheckCatalogItem {
  check_id: string;
  check_name: string;
  default_selected: boolean;
}

export interface ApprovalChecklistSummary {
  total: number;
  passed: number;
  failed: number;
  unknown: number;
}

export interface ApprovalChecklistItem {
  item_id: string;
  title: string;
  reasons?: string[];
  metrics?: Record<string, unknown>;
}

export interface ApprovalChecklistCheckResult {
  check_id: string;
  check_name: string;
  selected: boolean;
  status: "pass" | "fail" | "warning" | "error" | string;
  message?: string | null;
  summary: ApprovalChecklistSummary;
  passed_items?: ApprovalChecklistItem[];
  failed_items?: ApprovalChecklistItem[];
  unknown_items?: ApprovalChecklistItem[];
  northeast_view?: {
    status?: string;
    image_path?: string | null;
    message?: string;
  };
}

export interface ApprovalChecklistPayload {
  schema_version?: string;
  generated_at?: string;
  source_run_id?: string;
  project_id?: string;
  document?: {
    title?: string;
    number?: string;
    plot_name?: string;
    review_time?: string;
    selected_count?: number;
    review_comment?: string;
    conclusion?: string;
  };
  checks?: ApprovalChecklistCheckResult[];
  totals?: Record<string, number>;
  selected_totals?: Record<string, number>;
  source?: Record<string, unknown>;
}

export interface GenerateChecklistResponse {
  run_id: string;
  run_dir: string;
  payload: ApprovalChecklistPayload;
}

export interface SaveDraftResponse {
  project_id: string;
  checklist_payload: ApprovalChecklistPayload;
  number: string;
  plot_name: string;
  review_comment: string;
  conclusion: string;
  created_at?: string;
  updated_at: string;
}

const APPROVAL_BASE_ENV =
  process.env.NEXT_PUBLIC_HDMS_APPROVAL_BASE ||
  process.env.NEXT_PUBLIC_HDMS_APPROVAL_CHECKLIST_BASE ||
  "";
const APPROVAL_PROBE_TIMEOUT_MS = 1500;

let approvalBaseCache: string | null = null;
let approvalBaseInFlight: Promise<string> | null = null;

const normalizeError = async (response: Response) => {
  const body = await response.json().catch(() => null);
  const detail = body && typeof body.detail === "string" ? body.detail : "";
  return detail || `请求失败 (${response.status})`;
};

const inferApprovalBase = (reviewBase: string) => {
  const normalized = normalizeApiBase(reviewBase);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return normalized;
  }

  if (url.port === "8003") {
    url.port = "8004";
  } else if (url.port === "8023") {
    url.port = "8024";
  } else if (url.port) {
    const parsed = Number(url.port);
    if (Number.isFinite(parsed) && parsed > 0) {
      url.port = String(parsed + 1);
    }
  }
  return normalizeApiBase(url.toString());
};

const uniqueBases = (bases: string[]) => [...new Set(bases.filter(Boolean).map((base) => normalizeApiBase(base)))];

const canReachApprovalBase = async (base: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APPROVAL_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/approval-checklist/checks`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const discoverApprovalChecklistBase = async () => {
  const reviewBase = await resolveApiBase();
  const inferredBase = inferApprovalBase(reviewBase);
  const candidates = uniqueBases([inferredBase, reviewBase]);

  for (const candidate of candidates) {
    if (await canReachApprovalBase(candidate)) {
      return candidate;
    }
  }
  return inferredBase;
};

export async function resolveApprovalChecklistBase(options?: { forceRefresh?: boolean }) {
  if (APPROVAL_BASE_ENV) {
    return normalizeApiBase(APPROVAL_BASE_ENV);
  }
  if (!options?.forceRefresh && approvalBaseCache) {
    return approvalBaseCache;
  }
  if (approvalBaseInFlight) {
    return approvalBaseInFlight;
  }

  approvalBaseInFlight = discoverApprovalChecklistBase().finally(() => {
    approvalBaseInFlight = null;
  });

  const resolved = await approvalBaseInFlight;
  approvalBaseCache = resolved;
  return resolved;
}

const requestApprovalApi = async (path: string, init?: RequestInit) => {
  const base = await resolveApprovalChecklistBase();
  try {
    return await fetch(`${base}${path}`, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`无法连接审批清单服务（${base}）：${message}`);
  }
};

export async function fetchApprovalCheckCatalog() {
  const response = await requestApprovalApi("/approval-checklist/checks", {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await normalizeError(response));
  }
  const data = (await response.json()) as { checks: ApprovalCheckCatalogItem[] };
  return data.checks;
}

export async function generateApprovalChecklist(params: {
  project_id: string;
  model_path: string;
  selected_check_ids?: string[];
  observer_position?: { x: number; y: number; z: number };
  hemisphere_radius?: number;
}) {
  const response = await requestApprovalApi("/approval-checklist/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(await normalizeError(response));
  }
  return (await response.json()) as GenerateChecklistResponse;
}

export async function saveApprovalDraft(params: {
  project_id: string;
  checklist_payload: ApprovalChecklistPayload;
  number: string;
  plot_name: string;
  review_comment: string;
  conclusion: string;
}) {
  const response = await requestApprovalApi("/approval-checklist/drafts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(await normalizeError(response));
  }
  return (await response.json()) as SaveDraftResponse;
}

export async function loadApprovalDraft(projectId: string) {
  const response = await requestApprovalApi(`/approval-checklist/drafts/${encodeURIComponent(projectId)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await normalizeError(response));
  }
  return (await response.json()) as SaveDraftResponse;
}

export async function exportApprovalPdf(params: {
  project_id?: string;
  checklist_payload?: ApprovalChecklistPayload;
  file_name?: string;
}) {
  const response = await requestApprovalApi("/approval-checklist/export-pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(await normalizeError(response));
  }
  return await response.blob();
}
