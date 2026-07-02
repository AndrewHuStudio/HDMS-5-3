import type { SourceInfo } from "@/features/qa/types";

type SourceDetailsResponse = {
  chunk_id?: string;
  doc_id?: string;
  page_hint?: number | string | null;
  page_end_hint?: number | string | null;
  document?: {
    pdf_url?: string | null;
  };
};

function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const n = Math.trunc(value);
    return n > 0 ? n : null;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    // Allow numeric strings like "17"; reject "第17页" to avoid false positives.
    if (!/^\d+$/.test(s)) return null;
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function firstChunkId(source: SourceInfo): string | null {
  const direct = (source.chunk_id || "").trim();
  if (direct) return direct;
  const list = Array.isArray(source.chunk_ids) ? source.chunk_ids : [];
  for (const cid of list) {
    const s = String(cid || "").trim();
    if (s) return s;
  }
  return null;
}

function buildApiPdfUrl(docId: string): string {
  return `/api/rag/documents/${encodeURIComponent(docId)}/pdf`;
}

function appendPageHash(url: string, page: number | null): string {
  if (!page) return url;
  const base = url.split("#", 1)[0] ?? url;
  return `${base}#page=${page}`;
}

async function fetchSourceDetails(
  chunkId: string,
  query?: string,
  opts?: { resolvePage?: boolean },
): Promise<SourceDetailsResponse | null> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (opts?.resolvePage) params.set("resolve_page", "true");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const url = `/api/rag/sources/${encodeURIComponent(chunkId)}${suffix}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as SourceDetailsResponse;
}

export async function resolvePdfUrlForSource(
  source: SourceInfo,
  opts?: { preferredPage?: number; query?: string }
): Promise<string | null> {
  const preferredPage = toPositiveInt(opts?.preferredPage);
  let page = preferredPage ?? toPositiveInt(source.page);

  let fileUrl: string | null = null;
  const docId = (source.doc_id || "").trim();
  if (docId) {
    fileUrl = buildApiPdfUrl(docId);
  } else if (source.pdf_url) {
    fileUrl = String(source.pdf_url);
  }

  // Keep PDF opening fast: if we already know a PDF URL/doc_id, open it
  // immediately even when page is unknown. Page lookup can require scanning a
  // large PDF and should not block the viewer.
  if (!fileUrl && firstChunkId(source)) {
    try {
      const details = await fetchSourceDetails(firstChunkId(source) as string, opts?.query);
      if (details) {
        if (!page) page = toPositiveInt(details.page_hint);
        if (!fileUrl) {
          const detailsDocId = String(details.doc_id || "").trim();
          if (detailsDocId) {
            fileUrl = buildApiPdfUrl(detailsDocId);
          } else if (details.document?.pdf_url) {
            fileUrl = String(details.document.pdf_url);
          }
        }
      }
    } catch {
      // Network failures should not block opening the PDF altogether.
    }
  }

  if (!fileUrl) return null;
  return appendPageHash(fileUrl, page);
}
