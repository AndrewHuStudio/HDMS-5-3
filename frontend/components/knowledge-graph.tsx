/**
 * 知识图谱可视化组件
 * 使用 react-force-graph-2d 渲染知识图谱，
 * 支持节点类型过滤、悬停高亮、点击展开相关节点、自适应布局等功能。
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import type { SubgraphData } from "@/features/qa/types";
import {
  filterGraphWithHiddenTypes,
  type GraphViewData,
  type GraphViewNode,
} from "./knowledge-graph-filter";
import {
  buildRelatedNodes,
  computeLayoutTuning,
  getLinkNodeId,
  shouldShowNodeLabel,
} from "./knowledge-graph-utils";
// @ts-expect-error d3-force-3d package does not ship TypeScript declarations.
import { forceCollide, forceX, forceY } from "d3-force-3d";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

// Node type -> color mapping (research SCI palette from the provided design)
const NODE_COLORS: Record<string, string> = {
  法规: "#274753",
  标准: "#297270",
  空间要素: "#299d8f",
  片区: "#8ab07c",
  Document: "#e7c66b",
  导则: "#f3a361",
  地块: "#e66d50",
};

// Chinese labels for node types (identity mapping since labels are already Chinese)
const NODE_TYPE_LABELS: Record<string, string> = {
  片区: "片区",
  地块: "地块",
  空间要素: "空间要素",
  法规: "法规",
  标准: "标准",
  导则: "导则",
  Document: "文档",
};

// Chinese labels for relationship types (8 types)
const REL_TYPE_LABELS: Record<string, string> = {
  PART_OF: "属于",
  CONTAINS: "包含",
  ADJACENT_TO: "相邻",
  LOCATED_IN: "位于",
  APPLIES_TO: "适用",
  REFERENCES: "引用",
  DERIVED_FROM: "来源",
  HAS_PROPERTY: "属性",
  HIDDEN_BRIDGE: "隐藏后连接",
};

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return `rgba(107, 114, 128, ${alpha})`;
  const value = Number.parseInt(normalized, 16);
  if (Number.isNaN(value)) return `rgba(107, 114, 128, ${alpha})`;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface KnowledgeGraphProps {
  subgraph: SubgraphData | null;
  isStreaming?: boolean;
  height?: number;
}

export function KnowledgeGraph({
  subgraph,
  isStreaming,
  height,
}: KnowledgeGraphProps) {
  const graphRef = useRef<any>(null);
  const graphViewportRef = useRef<HTMLDivElement | null>(null);
  const resizingLegendRef = useRef(false);
  const [graphViewportSize, setGraphViewportSize] = useState({ width: 0, height: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<Set<string>>(new Set());
  const [legendWidth, setLegendWidth] = useState<number>(120);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const bgColor = isDark ? "#0f172a" : "#ffffff";
  const containerStyle = useMemo(
    () => (height == null ? { height: "100%" } : { height }),
    [height]
  );

  const rawGraphData = useMemo(() => {
    if (!subgraph || !subgraph.nodes || subgraph.nodes.length === 0) {
      return { nodes: [], links: [] };
    }

    // Compute degree for node sizing
    const degree: Record<string, number> = {};
    for (const edge of subgraph.edges || []) {
      degree[edge.source] = (degree[edge.source] || 0) + 1;
      degree[edge.target] = (degree[edge.target] || 0) + 1;
    }

    const nodes: GraphViewNode[] = subgraph.nodes.map((n) => ({
      id: n.id,
      name: n.name || "?",
      label: n.label || "Unknown",
      degree: degree[n.id] || 0,
      val: Math.max(4, Math.min(14, (degree[n.id] || 0) * 1.5 + 4)),
    }));

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: GraphViewData["links"] = (subgraph.edges || [])
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        type: e.type || "",
      }));

    return { nodes, links };
  }, [subgraph]);

  const graphData = useMemo(() => {
    return filterGraphWithHiddenTypes(rawGraphData, hiddenNodeTypes);
  }, [rawGraphData, hiddenNodeTypes]);

  const layoutTuning = useMemo(() => {
    return computeLayoutTuning({
      nodeCount: graphData.nodes.length,
      isDark,
    });
  }, [graphData.nodes.length, isDark]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphViewNode>();
    for (const node of graphData.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [graphData.nodes]);

  // Pre-compute degree map for degree-aware link strength
  const degreeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of graphData.nodes) {
      map.set(node.id, node.degree);
    }
    return map;
  }, [graphData.nodes]);

  useEffect(() => {
    if (!graphRef.current || graphData.nodes.length === 0) return;

    // Charge: repulsion between all nodes
    graphRef.current?.d3Force("charge")?.strength(layoutTuning.chargeStrength);

    // Link distance
    graphRef.current?.d3Force("link")?.distance(layoutTuning.linkDistance);

    // Degree-aware link strength: weaken links from high-degree hubs
    // so they don't create radial star patterns
    graphRef.current?.d3Force("link")?.strength((link: any) => {
      const srcId = getLinkNodeId(link.source);
      const tgtId = getLinkNodeId(link.target);
      const srcDeg = (srcId ? degreeMap.get(srcId) : null) ?? 1;
      const tgtDeg = (tgtId ? degreeMap.get(tgtId) : null) ?? 1;
      // d3 default formula: 1 / min(srcDeg, tgtDeg)
      // We use a softer version to avoid overly loose hubs
      const rawStrength = 1 / Math.sqrt(Math.max(srcDeg, tgtDeg));
      const scaledStrength = rawStrength * layoutTuning.linkStrengthScale;
      return Math.max(layoutTuning.minLinkStrength, scaledStrength);
    });

    // Collision
    graphRef.current?.d3Force(
      "collide",
      forceCollide((node: any) => (node.val || 6) + layoutTuning.collidePadding).iterations(2),
    );

    // Keep every graph size cohesive while still preserving local spacing.
    graphRef.current?.d3Force("gravityX", forceX(0).strength(layoutTuning.gravityStrength));
    graphRef.current?.d3Force("gravityY", forceY(0).strength(layoutTuning.gravityStrength));

    graphRef.current?.d3ReheatSimulation();
  }, [graphData.nodes.length, graphData.links.length, layoutTuning, degreeMap]);

  useEffect(() => {
    if (graphData.nodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }
    // If selected node was removed (e.g. by filtering), clear selection
    if (selectedNodeId && !nodeMap.has(selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [graphData.nodes, nodeMap, selectedNodeId]);

  // Collect active node types for legend
  const activeTypes = useMemo(() => {
    const types = new Set<string>();
    for (const node of rawGraphData.nodes) {
      types.add(node.label);
    }
    return Array.from(types).sort();
  }, [rawGraphData.nodes]);

  const visibleTypeCount = useMemo(() => {
    const types = new Set<string>();
    for (const node of graphData.nodes) {
      types.add(node.label);
    }
    return types.size;
  }, [graphData.nodes]);

  const nodeTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of rawGraphData.nodes) {
      counts[node.label] = (counts[node.label] || 0) + 1;
    }
    return counts;
  }, [rawGraphData.nodes]);

  const onToggleNodeType = (type: string) => {
    setHiddenNodeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const startResizeLegend = () => {
    resizingLegendRef.current = true;
  };

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!resizingLegendRef.current) return;
      const next = Math.max(90, Math.min(event.clientX - 24, 240));
      setLegendWidth(next);
    };
    const onMouseUp = () => {
      resizingLegendRef.current = false;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    if (graphData.nodes.length === 0) return;

    const target = graphViewportRef.current;
    if (!target) return;

    const updateViewportSize = () => {
      const nextWidth = target.clientWidth;
      const nextHeight = target.clientHeight;
      setGraphViewportSize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      );
    };

    updateViewportSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewportSize);
      return () => window.removeEventListener("resize", updateViewportSize);
    }

    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(target);
    return () => observer.disconnect();
  }, [graphData.nodes.length]);

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;
  const selectedNodeColor = selectedNode ? NODE_COLORS[selectedNode.label] || "#6b7280" : "#6b7280";

  const relatedNodes = useMemo(() => {
    return buildRelatedNodes({
      selectedNodeId,
      selectedNode,
      links: graphData.links,
      nodeMap,
      relTypeLabels: REL_TYPE_LABELS,
      nodeTypeLabels: NODE_TYPE_LABELS,
    });
  }, [selectedNodeId, selectedNode, graphData.links, nodeMap]);

  const fallbackGraphHeight = height == null ? 240 : Math.max(180, height - 40);
  const forceGraphHeight =
    graphViewportSize.height > 0 ? graphViewportSize.height : fallbackGraphHeight;
  const forceGraphWidth = graphViewportSize.width > 0 ? graphViewportSize.width : 640;

  if (!subgraph || rawGraphData.nodes.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={containerStyle}
      >
        {isStreaming ? "正在检索知识图谱..." : "提问后将展示知识推理路径"}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 rounded-md border border-border/50 bg-background" style={containerStyle}>
      <aside
        className="w-[24rem] shrink-0 border-r border-border/50 bg-muted/20 grid"
        style={{ gridTemplateColumns: `${legendWidth}px 8px minmax(0,1fr)` }}
      >
        <div className="graph-legend-rail h-full shrink-0 border-r border-border/50 bg-background/90 px-2 py-3">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground mb-2">图例</p>
          <div className="space-y-1">
            {activeTypes.map((type) => (
              <div key={type} className="rounded border border-border/50 px-1.5 py-1">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: NODE_COLORS[type] || "#6b7280" }}
                  />
                  <span className="text-muted-foreground truncate">{NODE_TYPE_LABELS[type] || type}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{nodeTypeCounts[type] ?? 0}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 cursor-pointer rounded-sm border border-transparent hover:border-border/70 hover:bg-transparent hover:text-foreground focus-visible:border-border/70 focus-visible:ring-1 focus-visible:ring-primary/50 dark:hover:bg-transparent"
                    onClick={() => onToggleNodeType(type)}
                    aria-label={`${hiddenNodeTypes.has(type) ? "显示" : "隐藏"}${NODE_TYPE_LABELS[type] || type}`}
                  >
                    {hiddenNodeTypes.has(type) ? (
                      <EyeOff className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <Eye className="h-3 w-3 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div
          className="cursor-col-resize bg-border/50 hover:bg-primary/30 transition-colors"
          onMouseDown={startResizeLegend}
          aria-label="调整图例宽度"
          role="separator"
        />

        <div className="p-3 space-y-3 overflow-y-auto">
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">节点信息</p>
            {selectedNode ? (
              <div
                className="rounded-md border p-3 space-y-2"
                style={{
                  borderColor: hexToRgba(selectedNodeColor, 0.5),
                  backgroundColor: hexToRgba(selectedNodeColor, isDark ? 0.22 : 0.12),
                }}
              >
                <p className="text-sm font-semibold break-all">{selectedNode.name}</p>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary" className="text-[10px]">
                    {NODE_TYPE_LABELS[selectedNode.label] || selectedNode.label}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    连接数 {selectedNode.degree}
                  </Badge>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">点击节点查看详情</p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">关联节点</p>
            <div className="space-y-1">
              {relatedNodes.length > 0 ? (
                relatedNodes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedNodeId(item.neighborId)}
                    className="w-full rounded border px-2 py-1.5 text-left transition-colors"
                    style={{
                      borderColor: hexToRgba(NODE_COLORS[item.neighborType] || "#6b7280", 0.45),
                      backgroundColor: hexToRgba(
                        NODE_COLORS[item.neighborType] || "#6b7280",
                        isDark ? 0.2 : 0.09,
                      ),
                    }}
                  >
                    <p className="text-xs font-medium truncate">{item.name}</p>
                    <div className="relation-flow mt-1 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="max-w-[5.5rem] truncate">{item.fromName}</span>
                      <span className="shrink-0">-</span>
                      <span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] text-foreground">
                        {item.type}
                      </span>
                      <span className="shrink-0">-&gt;</span>
                      <span className="min-w-0 truncate">{item.toName}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {item.fromLabel} - {item.type} - {item.toLabel}
                    </p>
                  </button>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">暂无关联节点</p>
              )}
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">节点 {graphData.nodes.length}</Badge>
            <Badge variant="outline" className="text-[10px]">关系 {graphData.links.length}</Badge>
            <Badge variant="outline" className="text-[10px]">类型 {visibleTypeCount}</Badge>
          </div>
        </div>
        <div ref={graphViewportRef} className="relative flex-1 min-h-0 overflow-hidden">
          {graphData.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              当前已隐藏全部类型，请在左侧图例点击眼睛恢复显示
            </div>
          ) : (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              nodeLabel={(node: any) => {
                const typeLabel = NODE_TYPE_LABELS[node.label] || node.label;
                return `[${typeLabel}] ${node.name}`;
              }}
              nodeColor={(node: any) => NODE_COLORS[node.label] || "#6b7280"}
              nodeRelSize={5}
              linkColor={(link: any) => {
                const sourceId = getLinkNodeId(link.source);
                const targetId = getLinkNodeId(link.target);
                const focusNodeId = hoveredNodeId ?? selectedNodeId;
                if (focusNodeId && (sourceId === focusNodeId || targetId === focusNodeId)) {
                  return layoutTuning.activeLinkColor;
                }
                return layoutTuning.inactiveLinkColor;
              }}
              linkWidth={(link: any) => {
                const sourceId = getLinkNodeId(link.source);
                const targetId = getLinkNodeId(link.target);
                const focusNodeId = hoveredNodeId ?? selectedNodeId;
                if (focusNodeId && (sourceId === focusNodeId || targetId === focusNodeId)) {
                  return 1.0;
                }
                return link.type === "HIDDEN_BRIDGE" ? 0.5 : 0.35;
              }}
              linkDirectionalArrowLength={3.2}
              linkDirectionalArrowRelPos={0.85}
              width={forceGraphWidth}
              height={forceGraphHeight}
              backgroundColor={bgColor}
              warmupTicks={graphData.nodes.length > 500 ? 60 : 0}
              cooldownTicks={graphData.nodes.length > 500 ? 200 : 120}
              onNodeClick={(node: any) => {
                setSelectedNodeId(node.id);
                if (node.x != null && node.y != null) {
                  graphRef.current?.centerAt(node.x, node.y, 600);
                  graphRef.current?.zoom(2.2, 600);
                }
              }}
              onBackgroundClick={() => setSelectedNodeId(null)}
              onNodeHover={(node: any) => setHoveredNodeId(node?.id ?? null)}
              nodeCanvasObject={(node: any, ctx, globalScale) => {
                const nx = node.x as number;
                const ny = node.y as number;
                if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

                const r = node.val || 5;
                const color = NODE_COLORS[node.label] || "#6b7280";
                const isSelected = node.id === selectedNodeId;
                const isHovered = node.id === hoveredNodeId;
                const drawR = isSelected ? r + 2 : isHovered ? r + 1 : r;

                // Outer glow ring for selected / hovered
                if (isSelected || isHovered) {
                  const gradient = ctx.createRadialGradient(
                    nx, ny, drawR,
                    nx, ny, drawR + 6,
                  );
                  gradient.addColorStop(0, hexToRgba(color, isSelected ? 0.4 : 0.25));
                  gradient.addColorStop(1, hexToRgba(color, 0));
                  ctx.beginPath();
                  ctx.arc(nx, ny, drawR + 6, 0, 2 * Math.PI, false);
                  ctx.fillStyle = gradient;
                  ctx.fill();
                }

                // Main circle with slight gradient for depth
                const bodyGrad = ctx.createRadialGradient(
                  nx - drawR * 0.3, ny - drawR * 0.3, drawR * 0.1,
                  nx, ny, drawR,
                );
                bodyGrad.addColorStop(0, hexToRgba(color, 1));
                bodyGrad.addColorStop(1, hexToRgba(color, 0.7));
                ctx.beginPath();
                ctx.arc(nx, ny, drawR, 0, 2 * Math.PI, false);
                ctx.fillStyle = bodyGrad;
                ctx.fill();

                // Thin bright border
                ctx.strokeStyle = isSelected
                  ? hexToRgba(color, 0.9)
                  : isHovered
                    ? hexToRgba(color, 0.6)
                    : hexToRgba(color, 0.3);
                ctx.lineWidth = isSelected ? 1.2 : isHovered ? 0.8 : 0.3;
                ctx.stroke();

                const showLabel = shouldShowNodeLabel({
                  isSelected,
                  isHovered,
                  degree: node.degree ?? 0,
                  globalScale,
                });
                if (!showLabel) return;

                // Keep node labels visible at every zoom level and keep text inside the node body.
                const safeScale = Math.max(globalScale, 0.01);
                const maxTextWidth = drawR * 1.55;
                const fontSize = Math.min(drawR * 0.85, Math.max(7 / safeScale, drawR * 0.35));
                ctx.font = `${fontSize}px sans-serif`;
                let name = node.name;
                // Truncate long labels to keep overlap manageable on dense graphs.
                if (ctx.measureText(name).width > maxTextWidth) {
                  while (name.length > 1 && ctx.measureText(name + "..").width > maxTextWidth) {
                    name = name.slice(0, -1);
                  }
                  name = name + "..";
                }

                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.strokeStyle = isDark ? "rgba(15,23,42,0.8)" : "rgba(248,250,252,0.9)";
                ctx.lineWidth = 2.2 / safeScale;
                ctx.fillStyle = isDark ? "#f8fafc" : "#0f172a";
                const labelY = ny;
                ctx.strokeText(name, nx, labelY);
                ctx.fillText(name, nx, labelY);
              }}
              linkCanvasObjectMode={() => "after"}
              linkCanvasObject={(link: any, ctx, globalScale) => {
                // Only render link labels when zoomed in enough to read them
                if (globalScale < 1.8) return;

                const relLabel = REL_TYPE_LABELS[link.type] || link.type;
                if (!relLabel) return;

                const src = link.source;
                const tgt = link.target;
                if (src?.x == null || src?.y == null || tgt?.x == null || tgt?.y == null) return;

                // Prioritize: always show labels for links connected to focused node
                const focusNodeId = hoveredNodeId ?? selectedNodeId;
                const srcId = getLinkNodeId(src);
                const tgtId = getLinkNodeId(tgt);
                const isConnectedToFocus = focusNodeId && (srcId === focusNodeId || tgtId === focusNodeId);
                // At moderate zoom only show focused links; at high zoom show all
                if (!isConnectedToFocus && globalScale < 3.5) return;

                const fontSize = Math.min(5, Math.max(2.2, 10 / globalScale));

                const midX = (src.x + tgt.x) / 2;
                const midY = (src.y + tgt.y) / 2;

                ctx.font = `${fontSize}px sans-serif`;
                const textWidth = ctx.measureText(relLabel).width;
                const pad = fontSize * 0.35;

                // Background pill
                ctx.fillStyle = isDark ? "rgba(15,23,42,0.75)" : "rgba(255,255,255,0.8)";
                ctx.fillRect(
                  midX - textWidth / 2 - pad,
                  midY - fontSize / 2 - pad,
                  textWidth + pad * 2,
                  fontSize + pad * 2,
                );

                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = isConnectedToFocus
                  ? (isDark ? "rgba(200,215,230,0.9)" : "rgba(30,41,59,0.85)")
                  : (isDark ? "rgba(148,163,184,0.7)" : "rgba(71,85,105,0.65)");
                ctx.fillText(relLabel, midX, midY);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
