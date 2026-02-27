import type { AISuggestionRequest, AISuggestionResponse } from "./types";

const APPROVAL_CHECKLIST_PORTS = [8004, 8024];

async function resolveApprovalChecklistBase(): Promise<string> {
  if (typeof window === "undefined") {
    return `http://localhost:${APPROVAL_CHECKLIST_PORTS[0]}`;
  }

  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";

  if (!isLocal) {
    return `${protocol}//${hostname}:${APPROVAL_CHECKLIST_PORTS[0]}`;
  }

  for (const port of APPROVAL_CHECKLIST_PORTS) {
    try {
      const response = await fetch(`${protocol}//${hostname}:${port}/health`, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        return `${protocol}//${hostname}:${port}`;
      }
    } catch {
      continue;
    }
  }

  return `${protocol}//${hostname}:${APPROVAL_CHECKLIST_PORTS[0]}`;
}

export async function generateAISuggestions(
  request: AISuggestionRequest
): Promise<AISuggestionResponse> {
  const apiBase = await resolveApprovalChecklistBase();
  const response = await fetch(`${apiBase}/ai-suggestion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "AI 建议生成失败");
  }

  return (await response.json()) as AISuggestionResponse;
}
