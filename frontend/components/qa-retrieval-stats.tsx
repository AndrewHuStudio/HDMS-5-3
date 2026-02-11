"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronRight, Search, Database, GitBranch, FileText } from "lucide-react";
import type { RetrievalStats } from "@/features/qa/types";

interface QARetrievalStatsProps {
  stats: RetrievalStats;
  isStreaming: boolean;
}

export function QARetrievalStats({ stats, isStreaming }: QARetrievalStatsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const totalHits = stats.vector_count + stats.graph_count + stats.keyword_count;

  if (totalHits === 0 && !stats.cached) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-2">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors">
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform duration-200 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <Search className="h-3 w-3 shrink-0" />
        <span className="font-medium">
          {stats.cached ? "缓存命中" : `检索完成 (${stats.fused_count} 条结果)`}
        </span>
        {isStreaming && (
          <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-6 rounded-md border border-border/50 bg-muted/30 px-3 py-2 space-y-2">
          <div className="flex flex-wrap gap-3 text-xs">
            <SourceBadge
              icon={<Database className="h-3 w-3" />}
              label="向量检索"
              count={stats.vector_count}
              weight={stats.weights?.vector}
            />
            <SourceBadge
              icon={<GitBranch className="h-3 w-3" />}
              label="知识图谱"
              count={stats.graph_count}
              weight={stats.weights?.graph}
            />
            <SourceBadge
              icon={<FileText className="h-3 w-3" />}
              label="关键词"
              count={stats.keyword_count}
              weight={stats.weights?.keyword}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {stats.reranked && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                已重排序
              </span>
            )}
            {stats.cached && (
              <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
                缓存命中
              </span>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SourceBadge({
  icon,
  label,
  count,
  weight,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  weight?: number;
}) {
  return (
    <div className="flex items-center gap-1 text-muted-foreground">
      {icon}
      <span>{label}:</span>
      <span className="font-semibold text-foreground">{count}</span>
      {weight !== undefined && (
        <span className="text-[10px]">({Math.round(weight * 100)}%)</span>
      )}
    </div>
  );
}
