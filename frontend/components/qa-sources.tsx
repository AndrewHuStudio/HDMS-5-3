"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronRight, FileText, GitBranch } from "lucide-react";
import type { SourceInfo } from "@/features/qa/types";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";

interface QASourcesProps {
  sources: SourceInfo[];
  query?: string;
}

interface SourcePreview {
  text: string;
  summary: string;
  matched_keywords: string[];
  section_title: string;
  has_table: boolean;
  has_image: boolean;
  document: { file_name: string; category: string; pages: number };
}

export function QASources({ sources, query }: QASourcesProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        引用来源
      </p>
      {sources.map((source, index) => (
        <SourceCard key={source.chunk_id || index} source={source} index={index + 1} query={query} />
      ))}
    </div>
  );
}

function SourceCard({ source, index, query }: { source: SourceInfo; index: number; query?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [loading, setLoading] = useState(false);

  const handleToggle = async (open: boolean) => {
    setIsOpen(open);
    if (open && !preview && source.chunk_id) {
      setLoading(true);
      try {
        const qParam = query ? `?q=${encodeURIComponent(query)}` : "";
        const res = await fetch(
          `${normalizeApiBase(API_BASE)}/rag/sources/${source.chunk_id}${qParam}`
        );
        if (res.ok) {
          setPreview(await res.json());
        }
      } catch {
        // silently fail - preview is optional
      } finally {
        setLoading(false);
      }
    }
  };

  const Icon = source.source === "knowledge_graph" ? GitBranch : FileText;
  const typeLabel = source.source === "knowledge_graph" ? "知识图谱" : "文档检索";

  return (
    <Collapsible open={isOpen} onOpenChange={handleToggle}>
      <CollapsibleTrigger
        id={`source-${index}`}
        className="flex w-full items-start gap-2 rounded-md border border-border/50 bg-card px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors"
      >
        <ChevronRight
          className={`mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium text-foreground">
              {source.name || "未知来源"}
            </span>
            {source.section && (
              <span className="truncate text-muted-foreground">
                - {source.section}
              </span>
            )}
            <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {typeLabel}
            </span>
          </div>
          {preview?.summary && !isOpen && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
              {preview.summary}
            </p>
          )}
        </div>
      </CollapsibleTrigger>
      {source.chunk_id && (
        <CollapsibleContent>
          <div className="ml-5 mt-1 rounded-md border border-border/30 bg-muted/20 px-3 py-2 space-y-2">
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
                <HighlightedText
                  text={preview.text}
                  keywords={preview.matched_keywords}
                />
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

  const escaped = keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(pattern);

  return (
    <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
      {parts.map((part, i) =>
        pattern.test(part) ? (
          <mark key={i} className="rounded bg-yellow-200/60 px-0.5 dark:bg-yellow-500/30">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}
