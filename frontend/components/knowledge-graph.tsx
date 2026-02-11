"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import type { SubgraphData } from "@/features/qa/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

// Node type -> color mapping for 15 entity types
const NODE_COLORS: Record<string, string> = {
  Topic: "#6366f1",
  Document: "#8b5cf6",
  Standard: "#3b82f6",
  DesignGuideline: "#0ea5e9",
  PerformanceDimension: "#14b8a6",
  Indicator: "#f59e0b",
  EvaluationMethod: "#84cc16",
  Plot: "#ef4444",
  Function: "#f97316",
  Requirement: "#ec4899",
  Location: "#06b6d4",
  District: "#a855f7",
  SpatialElement: "#10b981",
  ResearchFinding: "#eab308",
  ThresholdValue: "#64748b",
};

// Chinese labels for node types
const NODE_TYPE_LABELS: Record<string, string> = {
  Topic: "课题",
  Document: "文档",
  Standard: "标准",
  DesignGuideline: "设计导则",
  PerformanceDimension: "性能维度",
  Indicator: "指标",
  EvaluationMethod: "评估方法",
  Plot: "地块",
  Function: "功能",
  Requirement: "管控要求",
  Location: "位置",
  District: "片区",
  SpatialElement: "空间要素",
  ResearchFinding: "研究发现",
  ThresholdValue: "阈值",
};

// Chinese labels for relationship types
const REL_TYPE_LABELS: Record<string, string> = {
  DEFINES: "定义",
  EVALUATES: "评估",
  HAS_THRESHOLD: "阈值",
  CATEGORIZED_UNDER: "归属",
  MEASURED_BY: "测量",
  PRESCRIBES: "规定",
  APPLIES_TO: "适用",
  SUPPORTS: "支撑",
  DERIVED_FROM: "来源",
  INFLUENCES: "影响",
  HAS_INDICATOR: "指标",
  HAS_FUNCTION: "功能",
  HAS_REQUIREMENT: "要求",
  LOCATED_IN: "位于",
  PART_OF: "属于",
  ADJACENT_TO: "相邻",
  BELONGS_TO: "归属",
  CONTAINS: "包含",
};

interface InternalNode {
  id: string;
  name: string;
  label: string;
  val: number;
  x?: number;
  y?: number;
}

interface InternalLink {
  source: string;
  target: string;
  type: string;
}

interface KnowledgeGraphProps {
  subgraph: SubgraphData | null;
  isStreaming?: boolean;
  height?: number;
}

export function KnowledgeGraph({
  subgraph,
  isStreaming,
  height = 300,
}: KnowledgeGraphProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const bgColor = isDark ? "#0f172a" : "#ffffff";
  const labelBg = isDark ? "rgba(15, 23, 42, 0.85)" : "rgba(255, 255, 255, 0.85)";
  const labelColor = isDark ? "#e2e8f0" : "#1f2937";
  const linkColor = isDark ? "#475569" : "#94a3b8";

  const graphData = useMemo(() => {
    if (!subgraph || !subgraph.nodes || subgraph.nodes.length === 0) {
      return { nodes: [], links: [] };
    }

    // Compute degree for node sizing
    const degree: Record<string, number> = {};
    for (const edge of subgraph.edges || []) {
      degree[edge.source] = (degree[edge.source] || 0) + 1;
      degree[edge.target] = (degree[edge.target] || 0) + 1;
    }

    const nodes: InternalNode[] = subgraph.nodes.map((n) => ({
      id: n.id,
      name: n.name || "?",
      label: n.label || "Unknown",
      val: Math.max(4, Math.min(16, (degree[n.id] || 0) * 2 + 4)),
    }));

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: InternalLink[] = (subgraph.edges || [])
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        type: e.type || "",
      }));

    return { nodes, links };
  }, [subgraph]);

  // Collect active node types for legend
  const activeTypes = useMemo(() => {
    const types = new Set<string>();
    for (const node of graphData.nodes) {
      types.add(node.label);
    }
    return Array.from(types).sort();
  }, [graphData.nodes]);

  if (!subgraph || graphData.nodes.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        {isStreaming ? "正在检索知识图谱..." : "提问后将展示知识推理路径"}
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="flex-1 min-h-0">
        <ForceGraph2D
          graphData={graphData}
          nodeLabel={(node: any) => {
            const typeLabel = NODE_TYPE_LABELS[node.label] || node.label;
            return `[${typeLabel}] ${node.name}`;
          }}
          nodeColor={(node: any) => NODE_COLORS[node.label] || "#6b7280"}
          nodeRelSize={5}
          linkColor={() => linkColor}
          linkWidth={1.5}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={0.85}
          height={height - 32}
          backgroundColor={bgColor}
          cooldownTicks={80}
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const r = node.val || 5;
            const color = NODE_COLORS[node.label] || "#6b7280";

            // Draw circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)";
            ctx.lineWidth = 0.5;
            ctx.stroke();

            // Draw label below node
            const fontSize = Math.max(10 / globalScale, 2);
            if (fontSize < 3) return; // too small to read
            ctx.font = `${fontSize}px sans-serif`;
            const name =
              node.name.length > 20
                ? node.name.slice(0, 18) + "..."
                : node.name;
            const textWidth = ctx.measureText(name).width;
            const padding = fontSize * 0.3;

            ctx.fillStyle = labelBg;
            ctx.fillRect(
              node.x - textWidth / 2 - padding,
              node.y + r + 2,
              textWidth + padding * 2,
              fontSize + padding * 2,
            );

            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = labelColor;
            ctx.fillText(name, node.x, node.y + r + 2 + padding);
          }}
          linkCanvasObjectMode={() => "after"}
          linkCanvasObject={(link: any, ctx, globalScale) => {
            const fontSize = Math.max(8 / globalScale, 1.5);
            if (fontSize < 2) return; // too small
            const relLabel = REL_TYPE_LABELS[link.type] || link.type;
            if (!relLabel) return;

            const src = link.source;
            const tgt = link.target;
            if (!src?.x || !tgt?.x) return;

            const midX = (src.x + tgt.x) / 2;
            const midY = (src.y + tgt.y) / 2;

            ctx.font = `${fontSize}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = isDark ? "#94a3b8" : "#64748b";
            ctx.fillText(relLabel, midX, midY);
          }}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 py-1 text-[10px]">
        {activeTypes.map((type) => (
          <div key={type} className="flex items-center gap-1">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: NODE_COLORS[type] || "#6b7280" }}
            />
            <span className="text-muted-foreground">
              {NODE_TYPE_LABELS[type] || type}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
