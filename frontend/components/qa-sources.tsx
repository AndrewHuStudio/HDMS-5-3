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
}

interface SourcePreview {
  text: string;
  section_title: string;
  document: { file_name: string; category: string };
}

export function QASources({ sources }: QASourcesProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        引用来源
      </p>
      {sources.map((source, index) => (
        <SourceCard key={source.chunk_id || index} source={source} index={index + 1} />
      ))}
    </div>
  );
}

function SourceCard({ source, index }: { source: SourceInfo; index: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [loading, setLoading] = useState(false);

  const handleToggle = async (open: boolean) => {
    setIsOpen(open);
    if (open && !preview && source.chunk_id) {
      setLoading(true);
      try {
        const res = await fetch(`${normalizeApiBase(API_BASE)}/rag/sources/${source.chunk_id}`);
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
        className="flex w-full items-center gap-2 rounded-md border border-border/50 bg-card px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">
          {index}
        </span>
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
      </CollapsibleTrigger>
      {source.chunk_id && (
        <CollapsibleContent>
          <div className="ml-5 mt-1 rounded-md border border-border/30 bg-muted/20 px-3 py-2">
            {loading ? (
              <p className="text-xs text-muted-foreground">加载原文中...</p>
            ) : preview ? (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {preview.text}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">无法加载原文预览</p>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
