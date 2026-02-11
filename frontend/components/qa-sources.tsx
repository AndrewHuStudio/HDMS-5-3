"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, ExternalLink, FileText, GitBranch } from "lucide-react";
import type { SourceInfo } from "@/features/qa/types";
import { API_BASE, QA_API_BASE, normalizeApiBase } from "@/lib/api-base";
import { cn } from "@/lib/utils";

interface QASourcesProps {
  sources: SourceInfo[];
  query?: string;
  activeCitation?: number | null;
  onCitationHover?: (citation: number | null) => void;
  onCitationSelect?: (citation: number) => void;
  layout?: "inline" | "sidebar";
}


const resolveAssetLink = (rawUrl?: string | null) => {
  if (!rawUrl) return null;
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

export function QASources({
  sources,
  query,
  activeCitation,
  onCitationHover,
  onCitationSelect,
  layout = "inline",
}: QASourcesProps) {
  if (!sources || sources.length === 0) return null;

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
        <span className="text-[11px] text-muted-foreground">{sources.length} 条</span>
      </div>
      <div className="space-y-1.5">
        {sources.map((source, index) => (
          <SourceCard
            key={source.chunk_id || `${source.name}-${index}`}
            source={source}
            index={index + 1}
            query={query}
            isActive={activeCitation === index + 1}
            onHover={onCitationHover}
            onSelect={onCitationSelect}
          />
        ))}
      </div>
    </div>
  );
}

function SourceCard({
  source,
  index,
  query,
  isActive,
  onHover,
  onSelect,
}: {
  source: SourceInfo;
  index: number;
  query?: string;
  isActive: boolean;
  onHover?: (citation: number | null) => void;
  onSelect?: (citation: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const fetchPreview = useCallback(async () => {
    if (!source.chunk_id || preview || loading) return;

    setLoading(true);
    try {
      const qParam = query ? `?q=${encodeURIComponent(query)}` : "";
      const res = await fetch(
        `${normalizeApiBase(API_BASE)}/rag/sources/${source.chunk_id}${qParam}`
      );
      if (res.ok) {
        setPreview((await res.json()) as SourcePreview);
      }
    } catch {
      // preview is optional
    } finally {
      setLoading(false);
    }
  }, [loading, preview, query, source.chunk_id]);

  useEffect(() => {
    if (!isActive) return;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isActive]);

  const handleToggle = (open: boolean) => {
    setIsOpen(open);
    if (open && source.chunk_id) {
      void fetchPreview();
    }
  };

  const handleOpenDocument = () => {
    const fallbackPdfUrl = source.doc_id ? `/rag/documents/${source.doc_id}/pdf` : null;
    const effectivePdfUrl = source.pdf_url || preview?.document.pdf_url || fallbackPdfUrl;
    const targetUrl = resolveAssetLink(effectivePdfUrl);
    if (!targetUrl) return;

    const safePage = source.page || preview?.page_hint;
    const separator = targetUrl.includes("#") ? "" : "#";
    const pageSuffix = safePage ? `${separator}page=${safePage}` : "";
    window.open(`${targetUrl}${pageSuffix}`, "_blank", "noopener,noreferrer");
  };

  const Icon = source.source === "knowledge_graph" ? GitBranch : FileText;
  const typeLabel = source.source === "knowledge_graph" ? "知识图谱" : "文档检索";
  const fallbackPdfUrl = source.doc_id ? `/rag/documents/${source.doc_id}/pdf` : null;
  const hasDocumentLink = Boolean(source.pdf_url || preview?.document.pdf_url || fallbackPdfUrl);

  return (
    <Collapsible open={isOpen} onOpenChange={handleToggle}>
      <div
        ref={cardRef}
        onMouseEnter={() => onHover?.(index)}
        onMouseLeave={() => onHover?.(null)}
      >
        <CollapsibleTrigger
          id={`source-${index}`}
          className={cn(
            "flex w-full items-start gap-2 rounded-md border border-border/50 bg-card px-3 py-2 text-left text-xs transition-colors",
            "cursor-pointer hover:bg-muted/50"
          )}
          onClick={() => onSelect?.(index)}
        >
          <ChevronRight
            className={cn(
              "mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-90"
            )}
          />
          <span
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary"
          >
            {index}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium text-foreground">
                {source.name || "未知来源"}
              </span>
              {source.section && (
                <span className="truncate text-muted-foreground">- {source.section}</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5">{typeLabel}</span>
              {typeof source.page === "number" && source.page > 0 && (
                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-600">
                  第 {source.page} 页
                </span>
              )}
              {source.image_url && (
                <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-600">
                  含图片
                </span>
              )}
              {hasDocumentLink && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-muted"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleOpenDocument();
                  }}
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  打开文档
                </button>
              )}
            </div>
            {preview?.summary && !isOpen && (
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                {preview.summary}
              </p>
            )}
          </div>
        </CollapsibleTrigger>
      </div>
      {source.chunk_id && (
        <CollapsibleContent>
          <div className="ml-5 mt-1 space-y-2 rounded-md border border-border/30 bg-muted/20 px-3 py-2">
            {loading ? (
              <p className="text-xs text-muted-foreground">加载原文中...</p>
            ) : preview ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {preview.document.category && (
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600">
                      {preview.document.category}
                    </span>
                  )}
                  {preview.has_table && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">
                      含表格
                    </span>
                  )}
                  {preview.has_image && (
                    <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-600">
                      含图片
                    </span>
                  )}
                </div>
                {preview.images && preview.images.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {preview.images.map((image) => {
                      const imageUrl = resolveAssetLink(image.url);
                      if (!imageUrl) return null;
                      return (
                        <button
                          key={image.ref}
                          type="button"
                          className="group overflow-hidden rounded-md border border-border/40 bg-card text-left transition-colors hover:bg-muted"
                          onClick={() => window.open(imageUrl, "_blank", "noopener,noreferrer")}
                        >
                          <img src={imageUrl} alt={image.name || "参考图片"} className="h-20 w-full object-cover" loading="lazy" />
                          <span className="block truncate px-2 py-1 text-[10px] text-muted-foreground group-hover:text-foreground">
                            {image.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <HighlightedText text={preview.text} keywords={preview.matched_keywords} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">无法加载原文预览</p>
            )}
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
