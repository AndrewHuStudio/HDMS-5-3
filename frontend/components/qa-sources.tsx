/**
 * QA 来源引用组件
 * 展示答案的来源文档列表，支持预览、PDF 查看、图片展示、表格渲染等功能。
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, ExternalLink, FileText, GitBranch, X, FileSearch } from "lucide-react";
import type { SourceInfo } from "@/features/qa/types";
import { API_BASE, QA_API_BASE, normalizeApiBase } from "@/lib/api-base";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { PdfLightbox } from "@/components/pdf-lightbox";
import { deriveSourceMeta } from "@/lib/qa-source-meta";
import { normalizeSourcePreviewMarkdown } from "@/lib/normalize-source-preview-markdown";
import { QA_REMARK_PLUGINS } from "@/lib/qa-markdown-plugins";
import { resolvePdfUrlForSource } from "@/lib/resolve-pdf-url";
import { resolvePdfSearchKeyword } from "@/lib/pdf-auto-highlight";
import { getSourcePreviewCacheKey } from "@/lib/source-preview-cache";
import { normalizeCitationSources } from "@/lib/normalize-citation-sources";

interface QASourcesProps {
  sources: SourceInfo[];
  messageId?: string;
  query?: string;
  activeCitation?: string | null;
  onCitationHover?: (citation: string | null) => void;
  onCitationSelect?: (citation: string) => void;
  previewCache?: Record<string, SourcePreview[]>;
  setPreviewCache?: React.Dispatch<React.SetStateAction<Record<string, SourcePreview[]>>>;
  layout?: "inline" | "sidebar";
}

const SOURCE_META_TITLE_WIDTH_CH = 18;
const SOURCE_META_PAGE_WIDTH_CH = 10;
const SOURCE_META_VISUAL_WIDTH_CH = 7;


const resolveAssetLink = (rawUrl?: string | null) => {
  if (!rawUrl) return null;
  // Same-origin routes (Next.js) should not be rewritten to backend base URLs.
  if (rawUrl.startsWith("/api/")) return rawUrl;
  if (/^\/rag\/documents\/[^/?#]+\/image(?:\?|$)/i.test(rawUrl)) return `/api${rawUrl}`;
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  // Use QA_API_BASE for /rag/ endpoints (served by QA backend on port 8002)
  const base = rawUrl.startsWith("/rag/")
    ? normalizeApiBase(QA_API_BASE)
    : normalizeApiBase(API_BASE);
  return rawUrl.startsWith("/") ? `${base}${rawUrl}` : `${base}/${rawUrl}`;
};

export interface SourcePreviewImage {
  name: string;
  ref: string;
  url: string;
}

export interface SourcePreview {
  chunk_id: string;
  doc_id?: string;
  chunk_index?: number;
  page_hint?: number;
  page_end_hint?: number;
  text: string;
  summary: string;
  matched_keywords: string[];
  section_title: string;
  has_table: boolean;
  has_image: boolean;
  images?: SourcePreviewImage[];
  document: {
    doc_id?: string;
    file_name: string;
    category: string;
    pages: number;
    pdf_url?: string;
    markdown_path?: string;
  };
}

/** Strip HTML tags and markdown syntax for plain-text preview */
function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")           // HTML tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")  // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
    .replace(/#{1,6}\s+/g, "")         // headings
    .replace(/[*_~`]+/g, "")           // bold/italic/strike/code
    .replace(/\|/g, " ")              // table pipes
    .replace(/\s{2,}/g, " ")          // collapse whitespace
    .trim();
}

/** Build a full PDF URL with optional page anchor. Exported for use by CitationBadge. */
export function buildPdfUrl(source: SourceInfo, page?: number): string | null {
  // Always prefer same-origin proxy for document PDFs so the viewer can load them
  // without CORS and without triggering browser/extension PDF handlers.
  const raw = source.doc_id
    ? `/api/rag/documents/${source.doc_id}/pdf`
    : (source.pdf_url || null);

  const url = raw ? resolveAssetLink(raw) : null;
  if (!url) return null;
  const safePage = page ?? source.page;
  const pageSuffix = safePage ? `#page=${safePage}` : "";
  return `${url}${pageSuffix}`;
}

export function QASources({
  sources,
  messageId,
  query,
  activeCitation,
  onCitationHover,
  onCitationSelect,
  previewCache: externalPreviewCache,
  setPreviewCache: setExternalPreviewCache,
  layout = "inline",
}: QASourcesProps) {
  const sourcesNormalized = useMemo(() => normalizeCitationSources(sources ?? []), [sources]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  const [pdfSearchKeyword, setPdfSearchKeyword] = useState<string | undefined>(undefined);
  const [localPreviewCache, setLocalPreviewCache] = useState<Record<string, SourcePreview[]>>({});
  const previewCache = externalPreviewCache ?? localPreviewCache;
  const setPreviewCache = setExternalPreviewCache ?? setLocalPreviewCache;
  // If parent provides a cache, parent is responsible for prefetching.
  const prefetchingKeysRef = useRef<Set<string>>(new Set());
  const prefetchedImageUrlsRef = useRef<Set<string>>(new Set());

  if (!sourcesNormalized || sourcesNormalized.length === 0) return null;

  useEffect(() => {
    if (externalPreviewCache && setExternalPreviewCache) return;
    const PREFETCH_LIMIT = 12;
    const missing = sourcesNormalized
      .map((source) => {
        const key = getSourcePreviewCacheKey(source);
        if (!key || previewCache[key]?.length) return null;
        const firstChunkId = source.chunk_ids?.[0] ?? source.chunk_id;
        if (!firstChunkId) return null;
        return { key, chunkId: firstChunkId };
      })
      .filter((item): item is { key: string; chunkId: string } => Boolean(item));

    if (missing.length === 0) return;

    const qParam = query ? `?q=${encodeURIComponent(query)}` : "";

    missing.slice(0, PREFETCH_LIMIT).forEach(({ key, chunkId }) => {
      if (prefetchingKeysRef.current.has(key)) return;
      prefetchingKeysRef.current.add(key);

      void fetch(`/api/rag/sources/${encodeURIComponent(chunkId)}${qParam}`)
        .then(async (res) => (res.ok ? ((await res.json()) as SourcePreview) : null))
        .then((preview) => {
          if (!preview) return;
          setPreviewCache((prev) => {
            if (prev[key]?.length) return prev;
            return { ...prev, [key]: [preview] };
          });
        })
        .catch(() => {
          // Background prefetch should be silent.
        })
        .finally(() => {
          prefetchingKeysRef.current.delete(key);
        });
    });
  }, [externalPreviewCache, previewCache, query, setExternalPreviewCache, sourcesNormalized]);

  // Prefetch image binaries as soon as source metadata/preview metadata is available.
  // This reduces the delay between answer render and first visible image.
  useEffect(() => {
    const urls: string[] = [];

    for (const source of sourcesNormalized) {
      if (source.image_url) urls.push(source.image_url);
      if (Array.isArray(source.image_urls)) {
        urls.push(...source.image_urls.filter(Boolean));
      }
    }

    for (const previews of Object.values(previewCache)) {
      for (const preview of previews || []) {
        for (const image of preview.images || []) {
          if (image?.url) urls.push(image.url);
        }
      }
    }

    const MAX_PREFETCH_IMAGES = 12;
    for (const rawUrl of urls) {
      if (!rawUrl) continue;
      const resolved = resolveAssetLink(rawUrl);
      if (!resolved) continue;
      if (prefetchedImageUrlsRef.current.has(resolved)) continue;
      prefetchedImageUrlsRef.current.add(resolved);

      const img = new Image();
      img.decoding = "async";
      img.src = resolved;

      if (prefetchedImageUrlsRef.current.size >= MAX_PREFETCH_IMAGES) break;
    }
  }, [previewCache, sourcesNormalized]);

  return (
    <div
      className={cn(
        "space-y-2",
        layout === "sidebar" && "rounded-lg border border-border/60 bg-card/70 p-3"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          {layout === "sidebar" ? "证据来源" : "引用来源"}
        </p>
        <span className="text-[11px] text-muted-foreground">{sourcesNormalized.length} 条</span>
      </div>
      <div className="space-y-1.5">
        {sourcesNormalized.map((source, index) => {
          const label = source.citation_label || `${index + 1}`;
          const cacheKey = getSourcePreviewCacheKey(source);
          return (
            <SourceCard
              key={source.chunk_id || `${source.name}-${index}`}
              source={source}
              label={label}
              messageId={messageId}
              query={query}
              cachedPreviews={cacheKey ? previewCache[cacheKey] : undefined}
              onCachePreviews={(items) => {
                if (!cacheKey || items.length === 0) return;
                setPreviewCache((prev) => {
                  const existing = prev[cacheKey] ?? [];
                  if (existing.length >= items.length) return prev;
                  return { ...prev, [cacheKey]: items };
                });
              }}
              isActive={activeCitation === label}
              onHover={onCitationHover}
              onSelect={onCitationSelect}
              onLightbox={setLightboxSrc}
              onPdfOpen={(url, keyword) => {
                setPdfSrc(url);
                setPdfSearchKeyword(keyword);
              }}
            />
          );
        })}
      </div>

      {/* Image lightbox overlay */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/80"
            onClick={() => setLightboxSrc(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxSrc}
            alt="预览图片"
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* PDF preview overlay */}
      {pdfSrc && (
        <PdfLightbox
          src={pdfSrc}
          onClose={() => {
            setPdfSrc(null);
            setPdfSearchKeyword(undefined);
          }}
          searchKeyword={pdfSearchKeyword}
        />
      )}
    </div>
  );
}

function SourceCard({
  source,
  label,
  messageId,
  query,
  cachedPreviews,
  onCachePreviews,
  isActive,
  onHover,
  onSelect,
  onLightbox,
  onPdfOpen,
}: {
  source: SourceInfo;
  label: string;
  messageId?: string;
  query?: string;
  cachedPreviews?: SourcePreview[];
  onCachePreviews?: (items: SourcePreview[]) => void;
  isActive: boolean;
  onHover?: (citation: string | null) => void;
  onSelect?: (citation: string) => void;
  onLightbox?: (src: string) => void;
  onPdfOpen?: (src: string, searchKeyword?: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [previews, setPreviews] = useState<SourcePreview[]>(cachedPreviews ?? []);
  const [loading, setLoading] = useState(false);

  // Use chunk_ids (grouped) if available, otherwise fall back to single chunk_id
  const allChunkIds = source.chunk_ids?.length ? source.chunk_ids : (source.chunk_id ? [source.chunk_id] : []);

  useEffect(() => {
    if (!cachedPreviews?.length) return;
    setPreviews((prev) => (prev.length >= cachedPreviews.length ? prev : cachedPreviews));
  }, [cachedPreviews]);

  const fetchPreviews = useCallback(async () => {
    if (allChunkIds.length === 0 || previews.length > 0 || loading) return;

    setLoading(true);
    try {
      const qParam = query ? `?q=${encodeURIComponent(query)}` : "";
      const results = await Promise.all(
        allChunkIds.slice(0, 5).map(async (cid) => {
          try {
            const res = await fetch(
              `/api/rag/sources/${encodeURIComponent(cid)}${qParam}`
            );
            if (res.ok) return (await res.json()) as SourcePreview;
          } catch { /* skip failed */ }
          return null;
        })
      );
      const next = results.filter((r): r is SourcePreview => r !== null);
      setPreviews(next);
      if (next.length > 0) {
        onCachePreviews?.(next);
      }
    } catch {
      // previews are optional
    } finally {
      setLoading(false);
    }
  }, [allChunkIds, loading, onCachePreviews, previews.length, query]);

  const handleToggle = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      if (allChunkIds.length > 0) {
        void fetchPreviews();
      }
    }
  };

  const firstPreview = previews[0] ?? null;
  const meta = deriveSourceMeta(source, firstPreview);

  // Prefetch preview metadata when the initial source payload lacks key UI fields.
  // This fixes "page info only appears after expanding" for sources missing page/section.
  useEffect(() => {
    if (allChunkIds.length === 0) return;
    if (loading || previews.length > 0) return;
    const needsMeta = !meta.pageLabel || !meta.title;
    if (!needsMeta) return;
    void fetchPreviews();
  }, [allChunkIds.length, fetchPreviews, loading, meta.pageLabel, meta.title, previews.length]);

  /** Open PDF in overlay for a specific chunk page */
  const handleOpenPdf = (page?: number) => {
    const preferredPage = page ?? firstPreview?.page_hint ?? source.page;
    const searchKeyword = resolvePdfSearchKeyword(source, firstPreview?.text);

    // Debug logging
    console.log("Opening PDF with search keyword:", searchKeyword);
    console.log("Source data:", { quote: source.quote, page: preferredPage, name: source.name });

    void resolvePdfUrlForSource(source, { preferredPage, query }).then((url) => {
      if (!url) return;
      onPdfOpen?.(resolveAssetLink(url) ?? url, searchKeyword);
    });
  };

  const Icon = source.source === "knowledge_graph" ? GitBranch : FileText;
  const typeLabel = source.source === "knowledge_graph" ? "知识图谱" : "文档检索";
  const fallbackPdfUrl = source.doc_id ? `/rag/documents/${source.doc_id}/pdf` : null;
  const hasDocumentLink = Boolean(source.pdf_url || firstPreview?.document.pdf_url || fallbackPdfUrl);
  const hasVisualAsset = meta.hasImage || Boolean(firstPreview?.has_table);

  return (
    <Collapsible open={isOpen} onOpenChange={handleToggle}>
      <div
      >
        <CollapsibleTrigger
          asChild
        >
          <div
            id={messageId ? `source-${messageId}-${label}` : `source-${label}`}
            role="button"
            tabIndex={0}
            className={cn(
              "flex w-full items-start gap-2 rounded-md border border-border/50 bg-card px-3 py-2 text-left text-xs transition-colors",
              "cursor-pointer hover:bg-amber-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-amber-500/10",
              isOpen && "rounded-b-none border-b-0"
            )}
            onFocus={() => onHover?.(label)}
            onBlur={() => onHover?.(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                (e.currentTarget as HTMLDivElement).click();
              }
            }}
          >
            <ChevronRight
              className={cn(
                "mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200",
                isOpen && "rotate-90"
              )}
            />
            <span
              className="inline-flex shrink-0 items-center justify-center rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary"
            >
              {label}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium text-foreground">
                  {source.name || "未知来源"}
                </span>
              </div>
              <div
                className="mt-1 -ml-0.5 grid items-center gap-x-1 text-[10px] text-muted-foreground"
                style={{
                  gridTemplateColumns: `minmax(0, ${SOURCE_META_TITLE_WIDTH_CH}ch) minmax(0, ${SOURCE_META_PAGE_WIDTH_CH}ch) minmax(0, ${SOURCE_META_VISUAL_WIDTH_CH}ch) minmax(0,1fr) auto`,
                }}
              >
                {meta.title ? (
                  <span
                    title={meta.title}
                    className="inline-flex h-5 min-w-0 items-center truncate rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary/90"
                  >
                    {meta.title}
                  </span>
                ) : (
                  <span className="inline-flex h-5 min-w-0 items-center truncate rounded bg-muted px-1.5 py-0.5">{typeLabel}</span>
                )}
                {meta.pageLabel ? (
                  <span
                    title={meta.pageLabel}
                    className="inline-flex h-5 min-w-0 items-center truncate rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-600"
                  >
                    {meta.pageLabel}
                  </span>
                ) : (
                  <span aria-hidden className="inline-flex h-5" />
                )}
                {hasVisualAsset ? (
                  <span className="inline-flex h-5 min-w-0 items-center truncate rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-600">
                    含图表
                  </span>
                ) : (
                  <span aria-hidden className="inline-flex h-5" />
                )}
                <span aria-hidden />
                {hasDocumentLink && (
                  <button
                    type="button"
                    className="ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleOpenPdf(meta.page ?? undefined);
                    }}
                  >
                    <FileSearch className="h-2.5 w-2.5" />
                    查看PDF
                  </button>
                )}
              </div>
            </div>
          </div>
        </CollapsibleTrigger>
      </div>
      {allChunkIds.length > 0 && (
        <CollapsibleContent>
          <div className="rounded-b-md border border-t-0 border-border/50 bg-white/80 dark:bg-background/70">
            <div className="py-2 space-y-0">
              {loading ? (
                <div className="space-y-2 py-2">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              ) : previews.length > 0 ? (
                <>
                  {previews.map((pv, pvIdx) => {
                    const circledNum = String.fromCodePoint(0x2460 + pvIdx); // ①②③...
                    return (
                    <div
                      key={pv.chunk_id || pvIdx}
                      className={cn("py-0", pvIdx > 0 && "border-t border-border/40")}
                    >
                      {previews.length > 1 && (
                        <div className="flex flex-wrap items-center gap-1.5 bg-white/90 px-2 py-1 text-[11px] text-muted-foreground dark:bg-background/80">
                          <span className="font-semibold text-primary">{circledNum}</span>
                          {pv.section_title && <span className="truncate">{pv.section_title}</span>}
                          {pv.page_hint && pv.page_hint > 0 && (
                            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600">
                              第 {pv.page_hint}{pv.page_end_hint && pv.page_end_hint > pv.page_hint ? `-${pv.page_end_hint}` : ""} 页
                            </span>
                          )}
                        </div>
                      )}
                      {/* Chunk body content */}
                      <div className="px-2 py-2">
                        <div className="pr-3">
                          <ChunkMarkdown text={pv.text} docId={pv.doc_id || source.doc_id} onLightbox={onLightbox} />
                          {pv.has_table && hasDocumentLink && (
                            <ChunkPdfEmbed
                              page={pv.page_hint ?? source.page}
                              onOpenPdf={handleOpenPdf}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </>
              ) : (
                <p className="text-xs text-muted-foreground py-1">无法加载原文预览</p>
              )}
            </div>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function HighlightedText({ text, keywords }: { text: string; keywords: string[] }) {
  if (!keywords || keywords.length === 0) {
    return (
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
        {text}
      </p>
    );
  }

  const escaped = keywords.map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const splitPattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const exactPattern = new RegExp(`^(?:${escaped.join("|")})$`, "i");
  const parts = text.split(splitPattern);

  return (
    <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
      {parts.map((part, idx) =>
        exactPattern.test(part) ? (
          <mark key={`${part}-${idx}`} className="rounded bg-yellow-200/60 px-0.5 dark:bg-yellow-500/30">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${idx}`}>{part}</span>
        )
      )}
    </p>
  );
}

/** Embed PDF page inline for chunks that contain tables */
function ChunkPdfEmbed({
  page,
  onOpenPdf,
}: {
  page?: number;
  onOpenPdf: (page?: number) => void;
}) {
  return (
    <button
      type="button"
      className="mt-2 inline-flex items-center gap-1 rounded border border-border/60 bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
      onClick={() => onOpenPdf(page)}
    >
      <FileSearch className="h-3 w-3" />
      在阅读器中打开 PDF{page ? `（第 ${page} 页）` : ""}
    </button>
  );
}

/** Render chunk text as markdown with tables, images, and formatting */
function ChunkMarkdown({
  text,
  docId,
  onLightbox,
}: {
  text: string;
  docId?: string;
  onLightbox?: (src: string) => void;
}) {
  const processed = normalizeSourcePreviewMarkdown(text, {
    docId,
    qaApiBase: normalizeApiBase(QA_API_BASE),
  });

  return (
    <div className="chunk-markdown prose-xs prose max-w-none text-xs leading-relaxed text-muted-foreground dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={QA_REMARK_PLUGINS}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }], rehypeRaw]}
        components={{
          p: ({ children }) => {
            // Skip empty paragraphs that only produce whitespace
            const hasContent = Array.isArray(children)
              ? children.some((c) => c !== null && c !== undefined && c !== "")
              : children !== null && children !== undefined && children !== "";
            if (!hasContent) return null;
            return <p className="mb-1.5 last:mb-0">{children}</p>;
          },
          table: ({ children }) => (
            <div className="my-1 overflow-x-hidden">
              <table className="w-full table-fixed border-collapse text-[10px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted px-1.5 py-0.5 text-left font-semibold break-words">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-1.5 py-0.5 break-words">{children}</td>
          ),
          img: ({ src, alt }) => {
            const imgSrc = typeof src === "string" ? src : "";
            return (
              <span className="block my-2">
                <img
                  src={imgSrc}
                  alt={typeof alt === "string" ? alt : "参考图片"}
                  className="max-h-48 cursor-zoom-in rounded border border-border object-contain transition-opacity hover:opacity-80"
                  loading="lazy"
                  onClick={() => imgSrc && onLightbox?.(imgSrc)}
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.removeAttribute("src");
                    img.alt = "图片暂不可用";
                    img.style.cursor = "default";
                    img.className = "h-16 w-full rounded border border-dashed border-border bg-muted/40 text-[10px] text-muted-foreground";
                  }}
                />
              </span>
            );
          },
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          h1: ({ children }) => <h1 className="mb-1.5 mt-2 text-sm font-bold text-foreground">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-1 mt-2 text-[13px] font-bold text-foreground">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-1.5 text-xs font-semibold text-foreground">{children}</h3>,
          // H4 should read like body text in source previews (less visual weight than H1-H3).
          h4: ({ children }) => <h4 className="mb-0.5 mt-1 text-xs font-medium text-muted-foreground">{children}</h4>,
          ul: ({ children }) => <ul className="mb-1 list-disc pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="mb-1 list-decimal pl-4">{children}</ol>,
          li: ({ children }) => <li className="mb-0.5">{children}</li>,
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
